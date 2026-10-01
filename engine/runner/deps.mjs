// RUNNER_VERSION 1
//
// Resolución de las dos dependencias externas del motor: `yaml` y
// `@playwright/test`.
//
// Existe porque el motor y el package.json que tiene sus dependencias pueden
// vivir en directorios distintos, así que un `createRequire(import.meta.url)` a
// secas falla con "no pude importar 'yaml'" aunque el workspace tenga las
// dependencias instaladas.
//
// Se prueban tres orígenes, en este orden:
//
//   1. el propio runner   — por si el motor y las dependencias comparten árbol;
//   2. `DEMOS_DIR`        — el workspace del producto, donde vive el package.json;
//   3. el cwd             — para invocaciones a mano desde la raíz del repo.

import { createRequire } from "node:module";
import { join, resolve } from "node:path";

/** Node resuelve subiendo desde el archivo, así que alcanza con un path
 *  cualquiera dentro del directorio; no hace falta que exista. */
function requireFromDir(dir) {
  return createRequire(join(resolve(dir), "noop.js"));
}

function candidates() {
  const out = [createRequire(import.meta.url)];
  if (process.env.DEMOS_DIR) out.push(requireFromDir(process.env.DEMOS_DIR));
  out.push(requireFromDir(process.cwd()));
  return out;
}

/**
 * Importa una dependencia externa del motor. Devuelve el módulo, o `null` si no
 * está en ninguno de los tres orígenes — quien llama decide cómo explicarlo.
 */
export function requireDep(name) {
  for (const req of candidates()) {
    try {
      return req(name);
    } catch {
      // Sigue con el próximo origen.
    }
  }
  return null;
}

/** El mensaje de "falta X" es el mismo para las dos dependencias y para el
 *  doctor, así que se escribe una sola vez. */
export function missingDepMessage(name) {
  return (
    `No pude importar el paquete '${name}'.\n` +
    `  Instalalo en el repo de demos:  npm i -D ${name}\n` +
    `  (busqué en el motor, en DEMOS_DIR${process.env.DEMOS_DIR ? ` = ${process.env.DEMOS_DIR}` : " — sin definir"} y en ${process.cwd()})`
  );
}
