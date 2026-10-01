// RUNNER_VERSION 1
//
// Tests del bloque `intake:` — las respuestas de la entrevista previa.
//
//     node --test engine/runner/
//
// Se testea aparte de `pacing.test.mjs` porque no verifica un cálculo: verifica
// una PUERTA. La entrevista era la única regla del flujo que no tenía forma de
// fallar —todo lo demás rompe el lint— y por eso se salteaba en silencio. Que la
// puerta siga cerrada es exactamente lo que hay que pinnear: si alguien "limpia"
// este check, el síntoma no es un test rojo en otro lado, es una demo grabada
// con un alcance que nadie acordó, y eso no se nota hasta que se mira el video.

import test from "node:test";
import assert from "node:assert/strict";
import { lintIntake } from "./lint.mjs";

/** Corre el check y devuelve los mensajes, que es lo único que importa acá. */
function check(intake) {
  const errors = [];
  const warnings = [];
  lintIntake(intake, (m) => errors.push(m), (m) => warnings.push(m));
  return { errors, warnings };
}

const COMPLETO = {
  audience: "Un intendente evaluando reemplazar el mostrador. Después pide un piloto.",
  in: ["alta del reclamo desde el celular"],
  out: ["el panel de estadísticas — no es lo que decide una compra"],
  environment: "QA, cuentas sembradas por el seed",
  approved_by: "Producto (Inaki), 2026-03-09",
};

test("un intake completo no protesta", () => {
  const { errors, warnings } = check(COMPLETO);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("sin bloque intake falla, y el error dice que hay que preguntar", () => {
  const { errors } = check(undefined);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /intake/);
  // El mensaje tiene que desalentar el atajo obvio: completarlo adivinando.
  assert.match(errors[0], /NO lo completes adivinando/);
  assert.match(errors[0], /no reemplaza la entrevista/);
});

for (const field of ["audience", "out", "environment", "approved_by"]) {
  test(`falta '${field}' → error`, () => {
    const { [field]: _, ...sin } = COMPLETO;
    const { errors } = check(sin);
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(`intake\\.${field}`));
  });
}

test("'in' vacío es sólo advertencia: se puede grabar sin él", () => {
  const { in: _, ...sinIn } = COMPLETO;
  const { errors, warnings } = check(sinIn);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
});

// El caso que de verdad importa: copiar un arquetipo y no rellenarlo. Si los
// <placeholders> pasaran, la puerta estaría abierta para el camino MÁS probable.
test("los placeholders del arquetipo no pasan", () => {
  const { errors } = check({
    audience: "<Quién mira, y qué tiene que pasar después de mirar.>",
    out: ["<qué queda afuera, y por qué>"],
    environment: "<Contra qué entorno y con qué cuenta.>",
    approved_by: "<Quién aprobó el guion, y cuándo.>",
  });
  assert.equal(errors.length, 4);
});

test("vacío, en blanco y 'TODO' cuentan como sin contestar", () => {
  for (const valor of ["", "   ", "TODO", "tbd", "pendiente", "por definir"]) {
    const { errors } = check({ ...COMPLETO, approved_by: valor });
    assert.equal(errors.length, 1, `'${valor}' tendría que contar como sin contestar`);
  }
});

test("una lista vacía no alcanza para dar 'out' por contestado", () => {
  const { errors } = check({ ...COMPLETO, out: [] });
  assert.equal(errors.length, 1);
});
