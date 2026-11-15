---
title: Rendimiento
description: Lee el tiempo de arranque, la memoria y el rendimiento medidos frente al emulador oficial de Firestore, y aplícalos a tu propia suite de pruebas.
---

Fireemu se compara con el emulador oficial de Firestore usando las mismas cargas de trabajo de SDK. Ambos se ejecutan uno tras otro en el mismo runner Linux de GitHub Actions, con Fireemu usando el perfil `emulator`. El benchmark también comprueba los resultados de cada operación.

## Resultados

Estos resultados proceden de una ejecución `standard` en el commit `f3b942c`, comparando con el emulador de Firestore que ejecuta `firebase-tools` 15.28.2, con JDK 21.0.8. Los cocientes se calculan a partir de cinco pares medidos; los valores absolutos dependen del entorno.

| Métrica | Emulador oficial | Fireemu | Comparación |
|---|---:|---:|---:|
| Arranque hasta que el SDK puede usar Firestore | 3043 ms | 140 ms | 21,6× más rápido |
| Memoria en reposo con una base de datos vacía (PSS) | 390 MiB | 11 MiB | Aproximadamente 1/34 de la memoria |
| Memoria máxima durante una prueba (cgroup) | 849 MiB | 79 MiB | Aproximadamente 1/10,7 de la memoria |
| Rendimiento de Firestore en 22 cargas de trabajo | — | — | De 1,1× a 5,2× superior |

El intervalo de confianza del 95 % para el cociente del tiempo de arranque es [21,4; 21,8]. Para el cociente de memoria máxima (emulador oficial dividido por Fireemu) es [10,2; 11,1].

Consulta [benchmark.yml](https://github.com/fireemu/fireemu/blob/main/.github/workflows/benchmark.yml) para el workflow y [`tools/bench/`](https://github.com/fireemu/fireemu/tree/main/tools/bench) para el benchmark.

## Aplicar los resultados a una suite de pruebas

Usa los valores medidos de arranque y de memoria cargada para estimar únicamente la parte de tu propio flujo de trabajo que inicia estos motores. Rellena esta plantilla a partir de una ejecución validada y de tus propios recuentos de procesos:

| Magnitud | Línea base | Candidato |
|---|---:|---:|
| Arranque utilizable por el SDK, segundos | milisegundos medidos / 1000 | milisegundos medidos / 1000 |
| PSS en reposo con carga, MiB por motor | bytes medidos / 1048576 | bytes medidos / 1048576 |
| Arranques de motor en limpio en tu trabajo | recuento observado | recuento observado |
| Motores concurrentes en la meseta observada | recuento observado | recuento observado |

- **Arranques secuenciales.** La contribución del arranque es el número de segundos medidos por arranque multiplicado por el número de arranques observado.
- **Una meseta concurrente estable.** La contribución de memoria del motor son los MiB medidos multiplicados por el número de motores concurrentes observado.

Informa de estas contribuciones por separado de la instalación de dependencias, las compilaciones, la configuración del SDK y la ejecución de las pruebas. No establecen un ahorro de CI para el trabajo completo; mide el trabajo completo para afirmarlo.

## Para colaboradores: comparar un cambio

Esta sección es para quienes modifican el propio Fireemu. El runner Linux también acepta un binario de Fireemu de línea base proporcionado por quien lo invoca. Ambos binarios usan el mismo perfil de compatibilidad, la misma forma de fixture, la misma selección de servicios y la misma instalación de SDK. Cada prueba emparejada inicia un proceso nuevo. El manifiesto registra las rutas absolutas de los binarios, los digests SHA-256, las versiones y los hashes del harness. Un cambio de binario durante una ejecución, unos resultados no válidos o una limpieza fallida invalidan la comparación.

```sh
python3 tools/bench/bench.py --fireemu /path/to/candidate/fireemu --baseline-fireemu /path/to/baseline/fireemu --sdk-root conformance --tier standard --profile emulator --out .bench-candidate
python3 tools/bench/report.py .bench-candidate
```

La comparación predeterminada sigue siendo el emulador oficial frente a Fireemu, con la versión 2 del esquema de informe. Las comparaciones de binarios usan la versión 3 del esquema, las etiquetas explícitas `baseline-fireemu`/`candidate-fireemu` y los campos de medición `baseline_*`/`candidate_*`. Usa al menos cinco pares medidos de procesos nuevos para afirmar una mejora de rendimiento. Una comparación de binarios idénticos es un control útil; un intervalo que contiene 1 no establece una mejora.

### Formas de fixture

`--fixture-shape tiny` selecciona documentos escalares; `--fixture-shape wide-map` selecciona 32 campos de mapa anidados. El fixture predeterminado conserva su payload actual. Los campos oráculo de las consultas y la validación completa de la lectura de vuelta con el SDK se aplican a todas las formas. Compara cada forma por separado.

### Servicios mixtos

`--mixed-services` carga Auth, Storage y Firestore tanto en la fase aislada como en la solapada. Realiza 8 operaciones validadas por clase con concurrencia 2, una semilla fija, una operación de subida/lectura de vuelta/borrado de 64 KiB en Storage y sondeos reales de configuración de Auth, del registro del Hub y de lectura de Firestore. El informe conserva por separado las distribuciones de latencia y de rendimiento de cada clase.

- Una prueba mixta requiere un solapamiento observado entre Storage y otro servicio. Esto establece el solapamiento en el límite del cliente, no la ejecución simultánea dentro del servidor.
- La latencia de la operación de Storage incluye la subida, la lectura de vuelta y el borrado; no puede separar el tiempo en cola, el tiempo de ejecución ni la espera de bloqueos.
- Los límites existentes de 16 handlers y 2 slots de Glob siguen siendo la línea base de medición.
- La recuperación de permisos tras una cancelación requiere pruebas de runtime, y RSS/PSS corresponden al motor completo con carga.
- Para las comparaciones oficiales, descarga de antemano el emulador de Storage fijado con `pnpm -C conformance exec firebase setup:emulators:storage`.
- La preparación del arranque también valida cada servicio cargado.
- No participa ningún ejecutor de Functions.
