# SSHBond — revisión de publicación

Actualizado: 6 de septiembre de 2026.

## Resultado

Preparación para pruebas internas de Google Play y TestFlight. Todavía no se ha
validado la app instalada en un teléfono; no debe confundirse una compilación
correcta con esa validación ni enviarse a producción sin completarla.

## Correcciones aplicadas

- Bloqueo al abrir y volver a la app, conservando el terminal tras autenticar.
  Fallo cerrado si no hay biometría o no pueden leerse ajustes de seguridad.
- Rechazo de ProxyCommand y ForwardAgent no soportados, incluidos bastiones.
- El motor simulado solo puede utilizarse en desarrollo; una release sin módulo
  nativo falla explícitamente.
- iOS: el hilo de sesión es propietario de los recursos libssh2. Otros hilos
  solicitan cancelación e interrumpen el socket; no liberan memoria en uso.
- iOS: backports oficiales para CVE-2026-55199 y CVE-2026-55200 sobre libssh2
  1.11.1. Procedencia en el archivo SECURITY-PATCHES.md del código vendorizado.
- Android: Bouncy Castle 1.85.2 para Ed25519/Curve25519 con JSch 2.28.7. Exclusión
  de ambos jars de Jetifier y del manifiesto OSGi duplicado al empaquetar.
- Android: permisos de almacenamiento compartido y superposición bloqueados;
  backup de aplicación desactivado. iOS: motivo para acceso a red local.
- Política de privacidad dentro de la app y publicada en el repositorio;
  soporte info@yogabond.es. Textos de protección de claves corregidos.
- iOS identifica ProxyJump y túneles como funciones exclusivas de Android.

## Evidencia

- TypeScript, lint y 159 pruebas Jest / 14 suites correctos.
- Exportaciones JavaScript/Hermes de producción Android e iOS correctas.
- 68 comprobaciones / 13 escenarios contra OpenSSH real: autenticación, claves
  cifradas, rechazo de credenciales, verificación de huella antes de autenticar,
  PTY, UTF-8, resize, comandos, cancelación, túneles -L/-R/-D y cadenas ProxyJump.
  Se desactiva la selección multi-release de JSch para ejercitar Bouncy Castle.
- C de libssh2 compilado en Linux con AddressSanitizer y UndefinedBehaviorSanitizer.
  EXT_INFO malformados terminan sin fallo. El mismo test con packet.c original
  1.11.1 falla por timeout: la regresión detecta el bloqueo anterior.
- IPA iOS 1.0.0 (7) compilado en EAS. Inspección de Info.plist: identificador
  com.sshbond.client, SDK iphoneos26.0, mínimo iOS 15.1, declaración de cifrado
  activada y permiso de red local. Clase nativa SSHBondSession presente.
- No se ha descargado el SDK de Android localmente. Builds nativas en EAS.
- CI GitHub Actions 34040022612: completada correctamente para e5a1359.

## Dependencias npm

El audit registra 28 paquetes afectados (9 high / 19 moderate, incluyendo
propagación por dependencias). No son 28 vulnerabilidades distintas:

- image-size 1.2.1: parsers de imágenes de Metro, usados en compilación. Los
  assets de esta app son locales y no se procesan imágenes remotas en el móvil.
- PostCSS 8.4.49: herramienta de Metro; procesa fuentes de este repositorio
  durante el build. No se ejecuta como servicio que acepte CSS de terceros.
- uuid 7.0.3: dependencia de xcode/config-plugins para generar el proyecto, no
  generador de claves SSH. La alerta se refiere a buffers v3/v5/v6.
- decode-uri-component 0.2.2: query-string de Expo Router. Los únicos usos del
  paquete en el router instalado son stringify en getPathFromState y su helper;
  no invocan parse/decodificación. Una actualización directa a 0.5 cambia a ESM
  y no es compatible con el require de query-string 7 sin trabajo adicional.

Mantener pendiente una actualización coordinada de Expo/Metro y la migración de
xterm a @xterm. No se ha forzado una actualización incompatible para ocultar
alertas. Esta clasificación limita exposición conocida; no garantiza ausencia
de vulnerabilidades. El audit npm no cubre dependencias Kotlin/C/Swift.

## Tiendas

- Google Play: app 4974393873539602018, com.sshbond.client, creada en la cuenta
  existente. Declaraciones de políticas/exportación autorizadas por el titular.
  Prueba interna 1.0.0 (4) activa y disponible desde las 16:57 CEST;
  tester paugnu@gmail.com. Google validó min API 24 / target 36.
  SHA-256 del AAB: 827b304d322140893d23db640e20048e2a35d9fd33f651d463f370277f120f62.
  ZIP íntegro, módulo SSH en DEX y 88 bibliotecas nativas; ningún segmento LOAD
  de bibliotecas de 64 bits con alineación inferior a 16 KB. Única advertencia
  Play: archivo de desofuscación no adjunto. No hay errores bloqueantes.
- Apple: app 6809179913, mismo bundle ID, equipo W543Q9Q8K5. Perfil de firma
  propio y certificado existente; clave API de EAS asociada. EAS Submit
  aaf710cd-ac81-43ac-9f39-85c81169bd9b completó la transferencia del build 7,
  pero Apple lo rechazó después con ITMS-90592: falta el código de conformidad
  de cifrado correspondiente. No está disponible en TestFlight.
- Francia incluida por decisión explícita del titular. El cuestionario Apple
  exige el documento francés para algoritmos estándar fuera del sistema.
  Primer expediente ANSSI firmado y fechado, con formulario XFA, enviado
  el 6 de septiembre con autorización expresa; acuse de recibo de ANSSI confirmado el mismo día; pendiente de examen y attestation. Después de obtener el documento y la aprobación de Apple,
  incorporar su código al IPA y compilar/subir una nueva versión.
- Privacidad pública: https://github.com/paugnu/sshbond/blob/main/docs/privacy.md
- Soporte público: https://github.com/paugnu/sshbond/blob/main/docs/support.md
- App Privacy «Data Not Collected» publicado con autorización explícita.
- Apple: textos en en-US, es-ES y fr-FR guardados y verificados, clasificación
  calculada 4+, datos de contacto de revisión y acceso SSH de demo guardados.
- Play: textos en en-US, es-ES y fr-FR guardados, icono y gráfico
  destacado subidos. Herramientas, soporte HTTPS y email configurados; sin
  anuncios, funciones financieras, de salud ni carácter gubernamental.
  Acceso de revisión, audiencia 13+ y declaración sin recogida/cesión de datos
  guardados. Dos capturas auténticas del Pixel 5 añadidas; ficha lista para enviar
  a revisión, 10/11 tareas iniciales completadas. Pendiente IARC/aceptación de términos.
- Demo de revisión aislada en el VPS del titular, separada de YogaBond:
  contenedor de solo lectura, usuario no privilegiado, límites de recursos,
  sin volúmenes de producción y sin conexiones salientes. Contraseña, clave,
  túnel real y aislamiento comprobados; health de YogaBond correcto.
  Credenciales y operación permanecen en documentación local excluida de Git.
- Nueva ejecución del motor Android/JVM contra OpenSSH: 68 checks / 13 escenarios,
  todos correctos. Firebase Test Lab ha recibido el AAB 1.0.0 (4); la ejecución
  terminó correctamente en un Pixel 5 API 30: 89 acciones, 24 pantallas,
  5 min 12 s. Detectó 34 avisos de accesibilidad; primeras correcciones locales
  verificadas con TypeScript/lint/Jest y exportaciones Hermes, pendientes de
  nueva build y revalidación nativa. Ver android-firebase-results.md.
- Gratuidad autorizada por el titular: Play confirmado «Sin coste»; Apple
  configurado y verificado a 0 EUR, territorio base España. Disponibilidad
  inicial de España y Francia guardada y verificada en ambas tiendas.
- Build Android 1.0.0 (5) enviada a EAS desde b8f25a5:
  https://expo.dev/accounts/paugnu/projects/sshbond/builds/9f717f03-296e-4df7-b2ba-cbc611a1a99d
  Pendiente de terminar y revalidar en dispositivo; la build 4 sigue en Play.
- Visor de licencias sin conexión añadido. Inventario y omisiones documentados
  en third-party/README.md; no se considera cerrada la auditoría nativa.

## Antes del lanzamiento público

1. Completar la [prueba en dispositivo](real-device-testing.md): interfaz,
   Keychain/Keystore, biometría, teclado, segundo plano, cambio de red y conexión
   real desde cada plataforma. La prueba JVM no ejecuta ART ni Swift.
2. Completar IARC tras aceptar sus términos; añadir capturas auténticas de
   iPhone/iPad cuando se pueda ejecutar iOS. Mantener disponible la demo aislada
   mientras las tiendas revisan la app. Data safety, datos de revisión y la ficha
   de Play con capturas Android ya están guardados.
3. Resolver exportación de cifrado según mercados. La app incluye algoritmos
   estándar fuera de las APIs del sistema; no se ha marcado falsamente como
   exenta. Francia requiere resolver la documentación solicitada por Apple
   antes de distribuir allí. No excluir Francia para eludir ese trámite.
4. Cerrar las omisiones del inventario de atribuciones y comprobar las licencias
   de las dependencias nativas finales. Precio gratuito y España/Francia ya
   configurados. La distribución actual sigue siendo de pruebas internas.
