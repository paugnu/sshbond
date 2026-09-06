# Pruebas antes de publicar

Validación local del 6 de septiembre de 2026: **68 comprobaciones de SSH real
aprobadas en 13 escenarios**, **159 pruebas Jest aprobadas en 14 suites**, sin
errores de TypeScript/lint y exportaciones JavaScript/Hermes Android e iOS
correctas. Swift/libssh2 han compilado en EAS para iOS (IPA 1.0.0 build 7),
pero Apple ha rechazado el procesamiento por ITMS-90592 (cifrado). Android
1.0.0 (4) está disponible en la prueba interna de Google Play; AAB validado
por Play, incluido target SDK 36. No se ha probado todavía la app instalada
en un dispositivo. Compilar y examinar artefactos no sustituye esa prueba.

## Integración real y reproducible

```bash
npm run test:ssh:docker
```

Requiere Docker. Construye el motor Kotlin que usa Android y lo conecta a un
servidor OpenSSH real dentro del contenedor. No publica puertos ni utiliza claves
personales. Genera una clave Ed25519 con el generador de SSHBond, la autoriza en
el servidor y elimina las claves temporales al terminar. Un resultado correcto
exige código de salida 0 y `ALL CHECKS PASSED`.

Incluye autenticación y rechazo de clave, decisión de confianza previa a
autenticación, PTY, UTF-8, resize, comando remoto, túneles -L/-R/-D, errores de
forwarding y ProxyJump con uno y dos saltos. También prueba una clave privada
cifrada, una passphrase incorrecta y cancelación durante la aprobación de host.
Los marcadores de ejecución interactiva se construyen en el servidor para que
el simple eco del comando no haga pasar las pruebas.

El generador usa las APIs de criptografía equivalentes de Node dentro del
harness; las conexiones, el intercambio criptográfico, el servidor y el tráfico
de túneles son reales. Esto no valida los proveedores criptográficos de Android,
su KeyStore, la WebView ni el puente Expo. Tampoco ejecuta el motor Swift de iOS.
Se incluye Bouncy Castle 1.85.2 y se desactiva la selección multi-release de JSch
para ejercitar el proveedor ligero que necesita Android. No sustituye una prueba
en ART/Android. La integración queda incluida en `.github/workflows/verify.yml`.

## Prueba de la aplicación instalada

Usar un servidor de pruebas desechable y una cuenta sin acceso a datos reales.
No importar claves de producción. Para pruebas por LAN, el servidor debe ser
accesible desde el móvil y restringirse al dispositivo o a la red de pruebas;
el contenedor de integración anterior no es un servidor público para móviles.

1. Instalar Android 1.0.0 (4) desde la prueba interna de Google Play usando
   la cuenta autorizada. En iOS, esperar la resolución del cifrado y un build
   aceptado en TestFlight. Expo Go no sirve para esta validación.
2. Verificar que se muestra y funciona el motor real. Una build sin él debe
   fallar claramente, sin iniciar una sesión simulada.
3. Crear una clave dentro de la app, autorizar su parte pública en el servidor
   y conectar. Comparar la huella mostrada con `ssh-keygen -lf` en el servidor.
4. Rechazar una huella desconocida y probar un servidor cuya clave haya cambiado.
   Confirmar que no se envían comandos antes de aceptar una clave permitida.
5. Probar contraseña, clave importada cifrada, passphrase incorrecta, clave
   incorrecta y cancelación de prompts.
6. Ejecutar `whoami`, `uname -a`, `stty size`, `top` y un editor de texto. Probar
   UTF-8, teclado físico/virtual, Ctrl-C, resize, pegado multilínea y salida abundante.
7. Bloquear el móvil y volver. Con el bloqueo habilitado no debe mostrarse el
   terminal antes de autenticar. Probar cancelación, retirada de biometría y un
   error de lectura de ajustes. Comprobar que el terminal conserva la sesión.
8. Cambiar Wi-Fi/datos, perder la red, cerrar durante handshake, cerrar durante
   salida continua y repetir conexión/desconexión. En iOS, validar además con
   Address Sanitizer y Thread Sanitizer en ejecuciones separadas desde Xcode.
9. Android: validar tráfico por -L/-R/-D y ProxyJump. iOS: comprobar que las
   funciones no soportadas se explican como tales. En ambas plataformas,
   ProxyCommand y ForwardAgent no soportados deben rechazarse explícitamente.
10. Repetir una pasada con el AAB/IPA de producción distribuido por pruebas de
    Play/TestFlight, incluyendo instalación limpia y actualización conservando datos.

Registrar modelo de móvil, versión del sistema, identificador de build, resultado
y pasos de cualquier fallo. No adjuntar claves privadas, contraseñas ni salida de
servidores de producción. La publicación debe esperar a esta validación nativa,
en especial para el motor Swift: compilado en EAS, pero todavía no ejecutado
en un dispositivo durante esta revisión.

## Regresión de seguridad de libssh2

`docker run --rm sshbond-integration bash modules/expo-sshbond/integration/run-libssh2-security.sh`
compila el C vendorizado con AddressSanitizer y UndefinedBehaviorSanitizer. Envía
EXT_INFO malformados al parser real y exige que terminen sin bloqueo o errores
de memoria. Usa un timeout de 10 segundos y la configuración equivalente de
Linux; no ejecuta Swift. Los parches upstream y CVE quedan documentados en
`modules/expo-sshbond/ios/vendor/libssh2/SECURITY-PATCHES.md`.
