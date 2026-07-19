import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

export interface AuthIdentity {
  provider: "entra";
  subject: string;
  displayName: string;
  email: string | null;
  issuer: string;
}

export interface AuthVerifier {
  verify(accessToken: string): Promise<AuthIdentity>;
}

export interface EntraJwtVerifierOptions {
  authority: string;
  audience: string;
  issuer?: string | null;
}

interface OpenIdConfiguration {
  issuer: string;
  jwks_uri: string;
}

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  name?: string;
  nbf?: number;
  oid?: string;
  preferred_username?: string;
  scp?: string;
  email?: string;
  sub?: string;
  tid?: string;
}

interface JwksDocument {
  keys: JsonWebKey[];
}

export class EntraJwtVerifier implements AuthVerifier {
  private readonly authority: string;
  private readonly audience: string;
  private readonly configuredIssuer: string | null;
  private discovery: OpenIdConfiguration | null = null;
  private jwks: JwksDocument | null = null;

  constructor(options: EntraJwtVerifierOptions) {
    this.authority = options.authority.replace(/\/+$/, "");
    this.audience = options.audience;
    this.configuredIssuer = options.issuer ?? null;
  }

  async verify(accessToken: string): Promise<AuthIdentity> {
    const parts = accessToken.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid authentication token.");
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = parseJwtPart<JwtHeader>(encodedHeader);
    const payload = parseJwtPart<JwtPayload>(encodedPayload);

    if (header.alg !== "RS256" || !header.kid) {
      throw new Error("Unsupported authentication token.");
    }

    const discovery = await this.getDiscovery();
    const issuer = this.configuredIssuer ?? discovery.issuer;
    const now = Math.floor(Date.now() / 1000);

    if (payload.iss !== issuer) {
      throw new Error("Authentication token issuer is not trusted.");
    }

    if (!audienceMatches(payload.aud, this.audience)) {
      console.warn("Authentication token audience mismatch.", {
        expectedAudience: this.audience,
        tokenAudience: payload.aud,
        tokenIssuer: payload.iss,
        tokenScopes: typeof payload.scp === "string" ? payload.scp : undefined
      });
      throw new Error("Authentication token audience is not valid.");
    }

    if (!payload.exp || payload.exp <= now) {
      throw new Error("Authentication token has expired.");
    }

    if (payload.nbf && payload.nbf > now + 60) {
      throw new Error("Authentication token is not valid yet.");
    }

    await this.verifySignature(header, `${encodedHeader}.${encodedPayload}`, encodedSignature);

    const tokenSubject = payload.sub ?? payload.oid;
    if (!tokenSubject) {
      throw new Error("Authentication token is missing a subject.");
    }

    const displayName =
      payload.name ??
      payload.preferred_username ??
      payload.email ??
      "Player";

    return {
      provider: "entra",
      subject: `${issuer}|${tokenSubject}`,
      displayName,
      email: payload.email ?? payload.preferred_username ?? null,
      issuer
    };
  }

  private async verifySignature(
    header: JwtHeader,
    signingInput: string,
    encodedSignature: string
  ): Promise<void> {
    const jwks = await this.getJwks();
    const jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
    if (!jwk) {
      this.jwks = null;
      const refreshed = await this.getJwks();
      const refreshedJwk = refreshed.keys.find((candidate) => candidate.kid === header.kid);
      if (!refreshedJwk) {
        throw new Error("Authentication token signing key was not found.");
      }
      return verifyJwtSignature(refreshedJwk, signingInput, encodedSignature);
    }

    verifyJwtSignature(jwk, signingInput, encodedSignature);
  }

  private async getDiscovery(): Promise<OpenIdConfiguration> {
    if (this.discovery) {
      return this.discovery;
    }

    const response = await fetch(`${this.authority}/.well-known/openid-configuration`);
    if (!response.ok) {
      throw new Error("Unable to load Entra OpenID configuration.");
    }

    this.discovery = (await response.json()) as OpenIdConfiguration;
    return this.discovery;
  }

  private async getJwks(): Promise<JwksDocument> {
    if (this.jwks) {
      return this.jwks;
    }

    const discovery = await this.getDiscovery();
    const response = await fetch(discovery.jwks_uri);
    if (!response.ok) {
      throw new Error("Unable to load Entra signing keys.");
    }

    this.jwks = (await response.json()) as JwksDocument;
    return this.jwks;
  }
}

function parseJwtPart<T>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
}

function audienceMatches(audience: string | string[] | undefined, expected: string): boolean {
  if (Array.isArray(audience)) {
    return audience.includes(expected);
  }

  return audience === expected;
}

function verifyJwtSignature(
  jwk: JsonWebKey,
  signingInput: string,
  encodedSignature: string
): void {
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();

  const ok = verifier.verify(key, Buffer.from(encodedSignature, "base64url"));
  if (!ok) {
    throw new Error("Authentication token signature is not valid.");
  }
}
