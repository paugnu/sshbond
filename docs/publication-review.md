# SSHBond — revisión de publicación

Actualizado: 12 de septiembre de 2026. Las secciones iniciales conservan el
historial; consultar la actualización de producción al final para el estado actual.

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
  guardados. Dos capturas auténticas del Pixel 5 añadidas. IARC autorizado y
  completado (PEGI 3); declaración AD_ID «No» guardada. Las tres fichas y
  la build 4 del canal cerrado Alpha enviadas el 6 de septiembre: estado
  verificado «Cambios en revisión». Solo la cuenta del titular es tester;
  no se ha enviado una versión de producción.
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
  revalidación nativa con la build 5. Ver android-firebase-results.md.
- Gratuidad autorizada por el titular: Play confirmado «Sin coste»; Apple
  configurado y verificado a 0 EUR, territorio base España. Disponibilidad
  inicial de España y Francia guardada y verificada en ambas tiendas.
- Build Android 1.0.0 (5) enviada a EAS desde b8f25a5:
  https://expo.dev/accounts/paugnu/projects/sshbond/builds/9f717f03-296e-4df7-b2ba-cbc611a1a99d
  EAS confirmó FINISHED. Pendiente de revalidar en dispositivo; la build 4
  sigue en pruebas internas y en revisión para el canal cerrado de Play.
- Visor de licencias sin conexión añadido. Inventario y omisiones documentados
  en third-party/README.md; no se considera cerrada la auditoría nativa.

## Actualización del 10 de septiembre de 2026

- Google Play: canal cerrado Alpha activo, build 1.0.0 (4) disponible para
  testers autorizados. La consola ya no muestra cambios pendientes de revisión.
- Apple: 1.0.0 en Prepare for Submission, TestFlight sin builds aceptadas.
- El titular ha cambiado su preferencia: Francia queda temporalmente excluida
  de iOS. Guardado y verificado Spain / Available on App Release y
  France / Not Available. Google Play no se ha modificado.
- Cuestionario Apple: cifrado estándar fuera del sistema operativo, sin
  algoritmos propietarios y sin distribución en Francia. El resultado indica
  que no hacen falta documentos y permite declarar la exención en Info.plist.
  Se cambia ITSAppUsesNonExemptEncryption a false para esta distribución.
  Esto no afirma que SSHBond carezca de cifrado. Revaluar la declaración antes
  de reactivar Francia; el expediente ANSSI sigue pendiente.
- Referencia: https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/
- Build iOS 1.0.0 (8) lanzada desde ae939f5, perfil testing, con envío automático:
  https://expo.dev/accounts/paugnu/projects/sshbond/builds/bfec22ac-a9d7-42ed-b12e-0c55ccf6b3c2
  Envío EAS: 5a15feea-7165-407f-b3f3-1402e0f59995, FINISHED.
  IPA 1.0.0 (8) íntegro, bundle com.sshbond.client y declaración false verificados.
  SHA-256: 96280ebf3a83d15d346d3721ef4c31d24b9728462bf6de634c64ff37786f788c.
  Apple recibió la build el 10 de septiembre a las 08:55 CEST; procesamiento
  Complete y grupo interno con build en estado Testing verificados.
  ID de build Apple: d03ba88b-271a-435c-b0fd-8ea153026956.
  Invitación TestFlight recibida por el titular a las 08:58 CEST.
  Instrucciones de prueba guardadas en la build. No se ha enviado a revisión
  pública de App Store ni abierto un grupo externo.
- Grupo TestFlight existente «Pruebas internas»: un tester, la cuenta del titular.
  Información de beta, soporte y acceso a la demo completados.
- TypeScript, lint y 159 pruebas Jest correctos tras el cambio de configuración.
  Servicio demo activo; conexión SSH real con clave y verificación estricta de
  huella correctas. Esto no sustituye las pruebas desde iOS.


## Antes del lanzamiento público

1. Completar la [prueba en dispositivo](real-device-testing.md): interfaz,
   Keychain/Keystore, biometría, teclado, segundo plano, cambio de red y conexión
   real desde cada plataforma. La prueba JVM no ejecuta ART ni Swift.
2. Añadir capturas auténticas de
   iPhone/iPad cuando se pueda ejecutar iOS. Mantener disponible la demo aislada
   mientras las tiendas revisan la app. Data safety, datos de revisión y la ficha
   de Play con capturas Android ya están guardados.
3. Resolver exportación de cifrado según mercados. La app incluye algoritmos
   estándar fuera de las APIs del sistema; no se ha marcado falsamente como
   exenta. Francia requiere resolver la documentación solicitada por Apple
   antes de distribuir allí. Francia está temporalmente excluida de iOS por decisión posterior del titular;
   antes de reactivarla, completar la documentación y revaluar la declaración.
4. Cerrar las omisiones del inventario de atribuciones y comprobar las licencias
   de las dependencias nativas finales. Precio gratuito y España/Francia ya
   configurados. Pruebas internas activas y beta cerrada en revisión.

## Producción — 12 de septiembre de 2026

El titular validó las correcciones en TestFlight y autorizó publicar en producción.
Apple confirmó `WAITING_FOR_REVIEW` para 1.0.0 (13), con publicación automática
tras aprobación (`AFTER_APPROVAL`). La app aún no está publicada al guardar este
estado. Se mantiene España disponible y Francia excluida temporalmente de iOS.

- Versión Apple: `7a77ea31-b560-4725-9938-dfa9f15cf5c3`.
- Build Apple: `3f5bf390-bc10-4dca-95c9-3b867a6f875f`.
- Revisión: `7419926d-1f6d-4620-8e4b-993ae7c8e366`.
- EAS iOS: `871bafeb-90ab-41bc-a6f3-89b059435d2f`.
- IPA SHA-256: `cea15579a7ab517a5827667a6d8f99090ea3ac41d7e59eb44a72d05021bac695`.
- Capturas auténticas del simulador iPhone 1320×2868 e iPad 2064×2752,
  revisadas visualmente y aceptadas (`COMPLETE`) en en-US, es-ES y fr-FR.
  Solo se utilizaron las capturas de Hosts: las de navegación por URL mostraban
  un diálogo del sistema y se descartaron. EAS de capturas:
  `24345a15-4dff-4384-883d-fb75461a7c3c`.
- Datos de contacto/revisión verificados, credenciales de demo coincidentes y
  comando SSH real con clave y huella estricta correcto.
- TypeScript, lint y 169 pruebas / 16 suites correctos. Motor Android contra
  OpenSSH correcto; hash de SSHBondSession.kt del contenedor idéntico al actual.
- Licencias suplementarias npm incluidas y exclusiones restantes verificadas
  contra ambos mapas de fuentes Hermes. CocoaPods añade sus avisos resueltos
  antes de empaquetar iOS; se comprobó su presencia en el IPA final.
- Android 1.0.0 (6) compilado en EAS:
  `3b30c2c1-2a17-4811-97b8-dd6494893d21`. ZIP íntegro, 88 bibliotecas nativas,
  todos los segmentos LOAD de 64 bits alineados a 16 KB o más.
  SHA-256: `eb0038833583a6c05b42df3d9384ef5a4487e023b74d77ec8ed250ad4dd4f766`.
  En preparación para Firebase y Google Play; no se ha instalado el SDK Android.
- Google Play validó API mínima 24 / objetivo 36 y los símbolos nativos del AAB.
  Una advertencia no bloqueante indica que no hay mapa de desofuscación.
  El panel también advierte de optimización/ofuscación baja (1 %), con fecha
  límite febrero de 2027; planificar R8 y sus pruebas antes de ese plazo.
  Producción mantiene España y Francia. Publicación gestionada desactivada.
- Firebase de build 6: matriz `matrix-pmktg93ditt7a`, Pixel 5 / API 30, en_US,
  vertical, límite cinco minutos. Resultado **Correcta**, 1 dispositivo correcto,
  0 con errores; 5 min 10 s, 44 acciones y 16 pantallas. Es exploración Robo,
  no demuestra por sí sola autenticación SSH desde ART:
  https://console.firebase.google.com/project/yogabond-studio/testlab/histories/bh.edc211f887b03ef2/matrices/7199629988528755821
- Google Play: envío de producción 1.0.0 (6) confirmado como **Cambios en revisión**,
  con «Iniciar lanzamiento completo» y publicación gestionada desactivada. Se
  enviará/publicará automáticamente al superar los controles y la revisión de
  Google. No confundir este estado con disponibilidad pública ya confirmada.
