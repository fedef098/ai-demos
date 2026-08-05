/* TEMPLATE flow spec. Copy to docs/flows/<feature>.spec.ts and adapt.
   Pattern: login as the role -> create with real data -> assert it appears ->
   edit -> assert -> delete (cleanup) so the run is idempotent on a shared DB.
   Plus an RBAC assertion. Writing this FIRST surfaces real backend bugs before
   you ever record the demo. */
import { test, expect } from "@playwright/test";
import {
  loginAs, acceptDialogs, openModule, createRecord, editFirstRecord,
  deleteFirstRecord, search, expectRestricted, uniq,
} from "./support/actions";

test.describe("Example feature", () => {
  test("ADMIN can create, edit and delete", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "ADMIN");
    await openModule(page, "/example");

    const name = uniq("Ejemplo");
    await createRecord(page, { nombre: name, descripcion: "Datos completos", monto: "1500" });
    await search(page, name);
    await expect(page.locator("main")).toContainText(name);

    await editFirstRecord(page, { nombre: `${name} (editado)` });
    await search(page, `${name} (editado)`);
    await expect(page.locator("main")).toContainText("(editado)");

    await deleteFirstRecord(page); // cleanup — keep the live DB tidy
  });

  test("VIEWER is blocked by RBAC", async ({ page }) => {
    await loginAs(page, "VIEWER");
    await expectRestricted(page, "/example");
  });
});
