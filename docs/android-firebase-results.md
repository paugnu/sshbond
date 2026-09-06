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
Google marca la ficha como «Lista para enviar a revisión»; el panel indica
10 de 11 tareas iniciales completadas. Falta IARC, pendiente de la autorización
solicitada para sus términos. Las capturas muestran la build 4; reevaluarlas si
cambia sustancialmente el aspecto en la build siguiente. No se usan para iOS.
