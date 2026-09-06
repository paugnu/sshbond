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
  Prueba interna en preparación; tester paugnu@gmail.com.
- Apple: app 6809179913, mismo bundle ID, equipo W543Q9Q8K5. Perfil de firma
  propio y certificado existente; clave API de EAS asociada. iOS build 7 enviado
  correctamente por EAS Submit aaf710cd-ac81-43ac-9f39-85c81169bd9b.
- Privacidad pública: https://github.com/paugnu/sshbond/blob/main/docs/privacy.md
- Soporte público: https://github.com/paugnu/sshbond/blob/main/docs/support.md
- App Privacy «Data Not Collected» publicado con autorización explícita.

## Antes del lanzamiento público

1. Completar la [prueba en dispositivo](real-device-testing.md): interfaz,
   Keychain/Keystore, biometría, teclado, segundo plano, cambio de red y conexión
   real desde cada plataforma. La prueba JVM no ejecuta ART ni Swift.
2. Completar clasificación de edad, Data safety, ficha Play, capturas auténticas
   de iPhone/iPad/Android y datos de revisión. Preparar un servidor y credenciales
   desechables de revisión, sin exponer sistemas personales.
3. Resolver exportación de cifrado según mercados. La app incluye algoritmos
   estándar fuera de las APIs del sistema; no se ha marcado falsamente como
   exenta. Francia puede exigir declaración específica antes de distribuir allí.
4. Revisar atribuciones y licencias de todas las bibliotecas distribuidas, precio
   y países definitivos. La distribución actual prevista es de pruebas internas.
