import { AuthFlowError, type AuthProvider, type FlowCtx, type FlowOutcome, type Profile } from "./types";

/**
 * In-process stand-in for PingOne so the product can be demoed with no tenant.
 * Mock mode is explicit (PINGONE_MOCK=true) and is off in wrangler.jsonc.
 *
 *   robert@meridian.test / stake-demo     completes sign-on
 *   robert@meridian.test / mfa-demo       asks for OTP 482913
 */

export const MOCK_USERNAME = "robert@meridian.test";
export const MOCK_PASSWORD = "stake-demo";
export const MOCK_MFA_PASSWORD = "mfa-demo";
export const MOCK_OTP = "482913";

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

export function createMockPingOne(): AuthProvider {
  return {
    mode: "mock",
    async begin() {
      return {
        flowId: crypto.randomUUID(),
        cookies: "ST=mock-session",
        status: "USERNAME_PASSWORD_REQUIRED",
        devices: [],
      };
    },
    async checkPassword(_ctx: FlowCtx, username: string, password: string) {
      if (username.trim().toLowerCase() !== MOCK_USERNAME) {
        throw new AuthFlowError(400, "Invalid username and/or password.");
      }
      if (password === MOCK_MFA_PASSWORD) {
        return {
          flowId: _ctx.flowId,
          cookies: _ctx.cookies || "ST=mock-session",
          status: "OTP_REQUIRED",
          devices: [EMAIL_DEVICE],
          selectedDeviceId: EMAIL_DEVICE.id,
          username: MOCK_USERNAME,
          message: "Enter the code sent to your email.",
        };
      }
      if (password !== MOCK_PASSWORD) {
        throw new AuthFlowError(400, "Invalid username and/or password.");
      }
      return completed(_ctx);
    },
    async checkOtp(ctx, otp) {
      if (otp.trim() !== MOCK_OTP) throw new AuthFlowError(400, "That code is not valid.");
      return completed(ctx);
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
      };
    },
    async read(ctx): Promise<FlowOutcome> {
      return {
        flowId: ctx.flowId,
        cookies: ctx.cookies,
        status: "USERNAME_PASSWORD_REQUIRED",
        devices: [],
      };
    },
    async exchangeCode(input) {
      return {
        accessToken: `mock-access.${input.code}`,
        refreshToken: `mock-refresh.${input.code}`,
        idToken: "mock-id-token",
        expiresIn: 3600,
        tokenType: "Bearer",
      };
    },
    async refresh(refreshToken) {
      return {
        accessToken: `mock-access.refreshed.${refreshToken.slice(-6)}`,
        refreshToken: `mock-refresh.rotated.${crypto.randomUUID()}`,
        idToken: "mock-id-token",
        expiresIn: 3600,
        tokenType: "Bearer",
      };
    },
    async userInfo(accessToken) {
      if (!accessToken.startsWith("mock-access.")) {
        throw new AuthFlowError(401, "Mock access token was not recognized.");
      }
      return MOCK_PROFILE;
    },
    async endSession() {
      return;
    },
  };
}

function completed(ctx: FlowCtx): FlowOutcome {
  return {
    flowId: ctx.flowId,
    cookies: ctx.cookies || "ST=mock-session",
    status: "COMPLETED",
    code: `mock-code-${crypto.randomUUID()}`,
    devices: [],
    username: MOCK_USERNAME,
  };
}
