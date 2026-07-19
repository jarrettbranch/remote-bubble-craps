import { describe, expect, it } from "vitest";
import { displayNameFromClaims } from "../auth.js";

describe("displayNameFromClaims", () => {
  it("prefers Entra displayName over mapped name claims", () => {
    expect(
      displayNameFromClaims({
        displayName: "Avery Shooter",
        name: "Mapped Name",
        preferred_username: "avery@example.test",
        email: "fallback@example.test"
      })
    ).toBe("Avery Shooter");
  });

  it("falls back through standard human-readable Entra claims", () => {
    expect(displayNameFromClaims({ name: "Token Name" })).toBe("Token Name");
    expect(displayNameFromClaims({ preferred_username: "player@example.test" })).toBe(
      "player@example.test"
    );
    expect(displayNameFromClaims({ email: "email@example.test" })).toBe("email@example.test");
  });

  it("ignores blank values and uses Player when no display claim exists", () => {
    expect(displayNameFromClaims({ displayName: " ", name: "Named Player" })).toBe(
      "Named Player"
    );
    expect(displayNameFromClaims({})).toBe("Player");
  });
});
