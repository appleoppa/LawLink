// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "prisma/migrations/20260726060000_repair_v044_preservation_three_layer/migration.sql",
);

const requiredTables = [
  "PreservationCase",
  "PreservationTarget",
  "PreservationProperty",
  "PreservationPropertyRenewal",
];

describe("v0.44 preservation three-layer repair migration", () => {
  it("creates every Prisma model that the original empty migration omitted", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE \"${table}\"`);
      expect(sql).toContain(`CONSTRAINT \"${table}_pkey\" PRIMARY KEY`);
    }
  });

  it("adds the relation indexes and foreign keys required by schema.prisma", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("PreservationCase_matterId_idx");
    expect(sql).toContain("PreservationProperty_status_expiryDate_idx");
    expect(sql).toContain("PreservationTarget_caseId_fkey");
    expect(sql).toContain("PreservationPropertyRenewal_performedById_fkey");
  });
});
