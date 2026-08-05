/* Shared helpers for the per-flow E2E specs. The SAME low-level actions back
   both the test (assertions, headless) and the demo, so a flow is authored once.
   Adapt CREDS / selectors / button labels to your project. */
import { Page, expect } from "@playwright/test";

export type Role = "ADMIN" | "STAFF" | "VIEWER";

// Map demo roles -> real seeded usernames for THIS project.
export const CREDS: Record<Role, string> = {
  ADMIN: "DIRECCION",
  STAFF: "staff",
  VIEWER: "viewer",
};
export const PASS = process.env.DEMO_PASS || "";

/** Auto-accept the window.confirm() used by the delete action. Call once per page. */
export function acceptDialogs(page: Page) {
  page.on("dialog", (d) => d.accept().catch(() => {}));
}

export async function loginAs(page: Page, role: Role) {
  await page.goto("/login");
  await page.waitForSelector("#username", { state: "attached" });
  await page.fill("#username", CREDS[role]);
  await page.fill("#password", PASS);
  await page.getByRole("button", { name: "INICIAR SESIÓN" }).click();
  await page.waitForURL("**/dashboard", { timeout: 25_000 });
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}

export async function openModule(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
}

/** A role without access must see the RoleGuard "Acceso restringido" page. */
export async function expectRestricted(page: Page, route: string) {
  await page.goto(route);
  await expect(page.getByText("Acceso restringido")).toBeVisible({ timeout: 15_000 });
}

/** Open the "Agregar" dialog, fill fields by id (#name), and Crear. */
export async function createRecord(page: Page, fields: Record<string, string>) {
  await page.getByRole("button", { name: "Agregar" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  for (const [id, val] of Object.entries(fields)) await dialog.locator(`#${id}`).fill(val);
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForTimeout(600);
}

/** Edit the first row: open its pencil, change fields by id, Guardar cambios. */
export async function editFirstRecord(page: Page, fields: Record<string, string>) {
  await page.getByRole("button", { name: "Editar" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  for (const [id, val] of Object.entries(fields)) await dialog.locator(`#${id}`).fill(val);
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForTimeout(600);
}

/** Delete the first row (auto-accepts the confirm). Keeps the live DB clean. */
export async function deleteFirstRecord(page: Page) {
  await page.getByRole("button", { name: "Eliminar" }).first().click();
  await page.waitForTimeout(900);
}

export async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
  await page.waitForTimeout(500);
}

/** Filter the active list so the first row is the one we created. Scoped to
    <main> to avoid the topbar's global "Buscar..." input. */
export async function search(page: Page, text: string) {
  await page.locator('main input[placeholder^="Buscar"]').first().fill(text);
  await page.waitForTimeout(800);
}

/** Unique suffix so repeated runs don't collide and are easy to find/clean.
    Pass a stable seed (e.g. process.env.DEMO_SEED) for reproducible names. */
export const uniq = (p: string) =>
  `${p} E2E-${(process.env.DEMO_SEED || Date.now().toString()).slice(-6)}`;
