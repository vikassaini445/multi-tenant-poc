/** Identity established by JwtAuthGuard from a verified token. */
export interface AuthContext {
  readonly subject: string;
  readonly tenantId: string;
}

/** Claims this API requires in addition to iss/aud/exp, which the verifier checks. */
export interface AccessTokenClaims {
  sub?: unknown;
  tenant_id?: unknown;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthContext;
}
