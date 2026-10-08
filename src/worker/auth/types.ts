export interface PingOneConfig {
  authHost: string;
  envId: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  scopes: string;
}

export interface DeviceInfo {
  id: string;
  type: string;
  label: string;
}

export interface Profile {
  id: string;
  username: string;
  name: string;
  email: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number;
  tokenType: string;
}

export interface FlowCtx {
  flowId: string;
  cookies: string;
  state: string;
}

/**
 * Normalized PingOne flow result. Tokens never appear here — only an
 * authorization code once the flow reaches COMPLETED.
 */
export interface FlowOutcome {
  flowId: string;
  cookies: string;
  status: string;
  code?: string;
  devices: DeviceInfo[];
  selectedDeviceId?: string;
  username?: string;
  message?: string;
}

export interface AuthProvider {
  readonly mode: "mock" | "pingone";
  begin(input: { state: string; nonce: string; codeChallenge: string }): Promise<FlowOutcome>;
  checkPassword(ctx: FlowCtx, username: string, password: string): Promise<FlowOutcome>;
  checkOtp(ctx: FlowCtx, otp: string): Promise<FlowOutcome>;
  selectDevice(ctx: FlowCtx, deviceId: string): Promise<FlowOutcome>;
  read(ctx: FlowCtx): Promise<FlowOutcome>;
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  userInfo(accessToken: string): Promise<Profile>;
  endSession(input: { idToken?: string }): Promise<void>;
}

export class AuthFlowError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthFlowError";
    this.status = status;
  }
}

export type LoginView =
  | { step: "username_password"; loginId: string; username?: string; message?: string }
  | {
      step: "otp";
      loginId: string;
      devices: DeviceInfo[];
      selectedDeviceId?: string;
      message?: string;
    }
  | { step: "device_select"; loginId: string; devices: DeviceInfo[]; message?: string }
  | {
      step: "push";
      loginId: string;
      devices: DeviceInfo[];
      selectedDeviceId?: string;
      message?: string;
    }
  | { step: "unsupported"; loginId: string; status: string; message: string }
  | { step: "authenticated"; user: Profile; csrfToken: string };

export interface LoginRecord {
  id: string;
  flowId: string;
  cookies: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  status: string;
  createdAt: number;
}

export interface SessionRecord {
  id: string;
  csrfToken: string;
  user: Profile;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accessExpiresAt: number;
  createdAt: number;
  absoluteExpiresAt: number;
}
