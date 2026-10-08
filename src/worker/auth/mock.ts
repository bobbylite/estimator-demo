import { AuthFlowError, type AuthProvider, type FlowCtx, type FlowOutcome, type PingOneFault, type Profile } from "./types";

/**
 * In-process stand-in for PingOne so the product can be demoed with no tenant.
 * Mock mode is explicit (PINGONE_MOCK=true) and is off in wrangler.jsonc.
 *
 *   robert@meridian.test / stake-demo     completes sign-on
 *   robert@meridian.test / mfa-demo       asks for OTP 482913
 *   ada@meridian.test / Stake-1847        registers, then code 18472639
 */

export const MOCK_USERNAME = "robert@meridian.test";
export const MOCK_PASSWORD = "stake-demo";
export const MOCK_MFA_PASSWORD = "mfa-demo";
export const MOCK_OTP = "482913";
export const MOCK_REGISTER_USERNAME = "ada@meridian.test";
export const MOCK_REGISTER_EMAIL = "ada@meridian.test";
export const MOCK_REGISTER_PASSWORD = "Stake-1847";
export const MOCK_VERIFICATION_CODE = "18472639";

const MOCK_PROFILE: Profile = {
  id: "user-robert",
  username: MOCK_USERNAME,
  name: "Robert",
  email: MOCK_USERNAME,
};

const EMAIL_DEVICE = {
  id: "email-device",
  type: "EMAIL",
  label: "Email · r····@meridian.test",
};

interface Account {
  password: string;
  profile: Profile;
}

const accounts = new Map<string, Account>([[keyOf(MOCK_USERNAME), { password: MOCK_PASSWORD, profile: MOCK_PROFILE }]]);
const pending = new Map<string, Account>();
const codes = new Map<string, Profile>();

export function createMockPingOne(): AuthProvider {
  return {
    mode: "mock",
    async begin() {
      return {
        flowId: crypto.randomUUID(),
        cookies: "ST=mock-session",
        status: "USERNAME_PASSWORD_REQUIRED",
        devices: [],
        canRegister: true,
      };
    },
    async checkPassword(ctx, username, password) {
      const account = accounts.get(keyOf(username));
      if (!account) throw invalidCredentials();
      if (keyOf(username) === keyOf(MOCK_USERNAME) && password === MOCK_MFA_PASSWORD) {
        return {
          flowId: ctx.flowId,
          cookies: ctx.cookies || "ST=mock-session",
          status: "OTP_REQUIRED",
          devices: [EMAIL_DEVICE],
          selectedDeviceId: EMAIL_DEVICE.id,
          username: MOCK_USERNAME,
          message: "Enter the code sent to your email.",
          canRegister: true,
        };
      }
      if (password !== account.password) throw invalidCredentials();
      return completed(ctx, account.profile);
    },
    async checkOtp(ctx, otp) {
      if (otp.trim() !== MOCK_OTP) throw new AuthFlowError(400, "That code is not valid.");
      return completed(ctx, MOCK_PROFILE);
    },
    async selectDevice(ctx, deviceId) {
      if (deviceId !== EMAIL_DEVICE.id) throw new AuthFlowError(400, "Choose a device to continue.");
      return {
        flowId: ctx.flowId,
        cookies: ctx.cookies,
        status: "OTP_REQUIRED",
        devices: [EMAIL_DEVICE],
        selectedDeviceId: deviceId,
        message: "Enter the code sent to your email.",
        canRegister: true,
      };
    },
    async read(ctx): Promise<FlowOutcome> {
      return {
        flowId: ctx.flowId,
        cookies: ctx.cookies,
        status: "USERNAME_PASSWORD_REQUIRED",
        devices: [],
        canRegister: true,
      };
    },
    async register(ctx, input) {
      const username = input.username.trim();
      const email = input.email.trim();
      if (accounts.has(keyOf(username)) || [...accounts.values()].some((account) => keyOf(account.profile.email) === keyOf(email))) {
        throw taken(username);
      }
      const requirements = passwordRequirements(input.password);
      if (requirements.length) throw passwordPolicy(requirements);
      const profile: Profile = {
        id: `user-${keyOf(username).replace(/[^a-z0-9]+/g, "-")}`,
        username,
        name: username.split("@")[0] || username,
        email,
      };
      pending.set(ctx.flowId, { password: input.password, profile });
      return verification(ctx, email);
    },
    async verifyRegistration(ctx, verificationCode) {
      if (verificationCode.trim().toUpperCase() !== MOCK_VERIFICATION_CODE) throw invalidCode();
      const account = pending.get(ctx.flowId);
      if (!account) throw new AuthFlowError(404, "That sign-up expired. Start again.");
      accounts.set(keyOf(account.profile.username), account);
      pending.delete(ctx.flowId);
      return completed(ctx, account.profile);
    },
    async resendVerification(ctx) {
      if (!pending.has(ctx.flowId)) throw new AuthFlowError(404, "That sign-up expired. Start again.");
      return verification(ctx, pending.get(ctx.flowId)?.profile.email ?? "", "A new verification code was sent.");
    },
    async exchangeCode(input) {
      const profile = codes.get(input.code) ?? MOCK_PROFILE;
      const encoded = encodeProfile(profile);
      return {
        accessToken: `mock-access.${encoded}`,
        refreshToken: `mock-refresh.${encoded}`,
        idToken: "mock-id-token",
        expiresIn: 3600,
        tokenType: "Bearer",
      };
    },
    async refresh(refreshToken) {
      const encoded = refreshToken.slice("mock-refresh.".length).split(".")[0] ?? "";
      const profile = decodeProfile(encoded) ?? MOCK_PROFILE;
      const next = encodeProfile(profile);
      return {
        accessToken: `mock-access.${next}.${crypto.randomUUID()}`,
        refreshToken: `mock-refresh.${next}`,
        idToken: "mock-id-token",
        expiresIn: 3600,
        tokenType: "Bearer",
      };
    },
    async userInfo(accessToken) {
      if (!accessToken.startsWith("mock-access.")) {
        throw new AuthFlowError(401, "Mock access token was not recognized.");
      }
      const encoded = accessToken.slice("mock-access.".length).split(".")[0] ?? "";
      return decodeProfile(encoded) ?? MOCK_PROFILE;
    },
    async endSession() {
      return;
    },
  };
}

function verification(ctx: FlowCtx, email: string, message?: string): FlowOutcome {
  return {
    flowId: ctx.flowId,
    cookies: ctx.cookies || "ST=mock-session",
    status: "VERIFICATION_CODE_REQUIRED",
    devices: [],
    maskedEmail: maskEmail(email),
    message: message ?? "Enter the 8-character verification code from your email.",
    canRegister: true,
  };
}

function completed(ctx: FlowCtx, profile: Profile): FlowOutcome {
  const code = `mock-code-${crypto.randomUUID()}`;
  codes.set(code, profile);
  return {
    flowId: ctx.flowId,
    cookies: ctx.cookies || "ST=mock-session",
    status: "COMPLETED",
    code,
    devices: [],
    username: profile.username,
    canRegister: true,
  };
}

function invalidCredentials(): AuthFlowError {
  return new AuthFlowError(400, "Invalid username and/or password.");
}

function taken(username: string): AuthFlowError {
  const message = "A resource with the specified name already exists.";
  const fault: PingOneFault = {
    status: 400,
    code: "INVALID_DATA",
    message: "The request could not be completed. One or more validation errors were in the request.",
    details: [{ code: "UNIQUENESS_VIOLATION", target: "username", message: `${message} (${username})` }],
  };
  return new AuthFlowError(400, message, fault);
}

function passwordPolicy(requirements: string[]): AuthFlowError {
  const fault: PingOneFault = {
    status: 400,
    code: "INVALID_DATA",
    message: "The provided password did not satisfy the password policy requirements.",
    details: requirements.map((requirement) => ({
      code: "INVALID_VALUE",
      target: "password",
      message: requirement,
    })),
  };
  return new AuthFlowError(400, requirements.join(" "), fault);
}

function invalidCode(): AuthFlowError {
  const message = "The verification code is invalid.";
  const fault: PingOneFault = {
    status: 400,
    code: "INVALID_DATA",
    message,
    details: [{ code: "INVALID_VALUE", target: "verificationCode", message }],
  };
  return new AuthFlowError(400, message, fault);
}

function passwordRequirements(password: string): string[] {
  const requirements: string[] = [];
  if (password.length < 8) requirements.push("At least 8 characters.");
  if (!/[A-Za-z]/.test(password)) requirements.push("At least one letter.");
  if (!/\d/.test(password)) requirements.push("At least one number.");
  return requirements;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 2)}****@${domain}`;
}

function keyOf(value: string): string {
  return value.trim().toLowerCase();
}

function encodeProfile(profile: Profile): string {
  const bytes = new TextEncoder().encode(JSON.stringify(profile));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeProfile(value: string): Profile | undefined {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Profile>;
    if (!parsed.id || !parsed.username || !parsed.email || !parsed.name) return undefined;
    return { id: parsed.id, username: parsed.username, name: parsed.name, email: parsed.email };
  } catch {
    return undefined;
  }
}
