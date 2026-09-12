# Android: ejecución real en Firebase, 6 de septiembre de 2026

- Artefacto: SSHBond 1.0.0 (4), AAB distribuido por pruebas internas.
- Dispositivo: Pixel 5, Android 11 / API 30, inglés de EE. UU., vertical.
- Matriz: `matrix-27v2e0uuvgt89`; ejecución `bs.57d71288b0a5e5a0`.
- Resultado de Firebase: **Correcta**, 1 dispositivo correcto, 0 con errores.
- Duración: 5 min 12 s; exploración Robo 4 min 59 s hasta el límite configurado.
- Cobertura exploratoria: 89 acciones, 6 actividades, 24 pantallas.
- Informe: https://console.firebase.google.com/project/yogabond-studio/testlab/histories/bh.edc211f887b03ef2/matrices/8838458792094411273

Robo ejecutó la app instalada. No configuramos un guion de autenticación SSH:
este resultado no demuestra una conexión SSH de extremo a extremo desde ART,
ni valida biometría, cambios de red o teclado externo. Las 68 comprobaciones
SSH contra OpenSSH siguen siendo una prueba separada del motor en JVM.

## Accesibilidad

Firebase encontró 34 incidencias: 15 de tamaño táctil, 14 de contraste,
4 de etiquetas y 1 de implementación (18 advertencias y 16 problemas menores).
Se identificaron visualmente campos de generación de claves de 37 dp y el
botón de guardado rápido sin etiqueta. Esta revisión amplía campos, botones,
chips y controles de ajustes a un mínimo de 48 dp; añade etiquetas al guardado
rápido, los controles de tamaño de fuente y el cierre de diálogos de claves;
mejora el contraste del texto secundario tenue.

No se dan por cerradas las 34 incidencias: es necesaria otra ejecución nativa
con la nueva build. También se ha añadido el visor local de licencias, que
requiere esa nueva build. TypeScript, lint, 159 pruebas Jest y exportaciones
Hermes Android/iOS han pasado tras los cambios.

## Capturas y ficha

Los originales `1.png` (Hosts) y `2.png` (Settings), 1080×2340, se descargaron
sin editar de los artefactos de Firebase y se guardaron en la ficha de Play.
IARC completado con autorización del titular: PEGI 3. Declaración de ID de
publicidad guardada como «No» tras comprobar la ausencia del permiso AD_ID.
La ficha en español, inglés y francés y la build 4 del canal cerrado Alpha
se enviaron a Google el 6 de septiembre; estado verificado «Cambios en revisión».
El canal está limitado a la cuenta del titular. No se envió una versión de
producción. Las capturas muestran la build 4; reevaluarlas si
cambia sustancialmente el aspecto en la build siguiente. No se usan para iOS.

## Nueva compilación

EAS completó Android 1.0.0 (5), compilada desde `b8f25a5`, con las primeras
correcciones y el visor de licencias. AAB descargado y comprobado: ZIP íntegro,
sin permiso AD_ID y segmentos ELF de las bibliotecas de 64 bits alineados a
16 KB o más. Estas comprobaciones no sustituyen una ejecución en dispositivo.

SHA-256: `b658ead6b8b10a098b2d70a9b88f356b95f7e3d801552bf1fcbda12a1ed1487e`.

La build 5 no se ha enviado al canal cerrado ni ejecutado en Firebase todavía.

## Build 6 — 12 de septiembre de 2026

La build 6 final de producción se ejecutó en un Pixel 5 físico, API 30, en_US,
vertical. Firebase informó **Correcta**, 1 dispositivo correcto y 0 con errores.
Duración total 5 min 10 s; exploración 4 min 57 s hasta el límite establecido,
44 acciones, 2 actividades y 16 pantallas. El límite de tiempo de exploración
no representa un fallo de la aplicación. No se suministró un guion SSH, por lo
que se mantiene la distinción entre Robo y las pruebas del motor contra OpenSSH.

Matriz: `matrix-pmktg93ditt7a`; ejecución: `bs.8b72fe6af501cadc`.
Informe: https://console.firebase.google.com/project/yogabond-studio/testlab/histories/bh.edc211f887b03ef2/matrices/7199629988528755821

SHA-256 del AAB: `eb0038833583a6c05b42df3d9384ef5a4487e023b74d77ec8ed250ad4dd4f766`.
Después de esta comprobación se envió la versión al canal de producción de Play;
la consola confirmó «Cambios en revisión». Ver `publication-review.md`.
