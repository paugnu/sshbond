# Formularios y teclado — 12 de septiembre de 2026

## Cambios

- Add Host / Raw Config y Ajustes comparten la misma importación de todos los
  hosts. Actualiza por alias conservando identidad, grupos, favoritos y tags.
  La escritura se realiza una vez; si falla, no se publica una lista parcial.
  El formulario de edición individual rechaza configuraciones múltiples para
  evitar descartar hosts silenciosamente al cambiar de modo.
- Editor de hosts: ajuste al teclado con altura real de cabecera, botones fuera
  del scroll, margen inferior de zona segura, botón Hide keyboard, acciones
  táctiles de 48 puntos y salto de línea de la barra de acciones si hace falta.
- Componente compartido FormScrollView / FormInput: taps en botones funcionan
  con el teclado abierto, cierre al arrastrar, Done en campos de una línea y
  desplazamiento al campo activo tras foco o cambios de tamaño del viewport.
- Modales de configuración, importación/generación de claves y contraseña:
  zona segura, contenido desplazable y salida explícita del teclado separada
  de las cabeceras. Importar/exportar usa pestañas cortas que pueden ajustarse.
- Claves: campos independientes para privada y pública, área pública de 120
  puntos, selección de archivos para ambas. Se elimina la copia temporal del
  selector. Se mantienen la derivación automática y validación de coincidencia.
- Hosts: gesto izquierdo existente afinado, Edit/Delete accesibles, no hay
  borrado automático al deslizar; confirmación antes de eliminar. También hay
  menú visible de acciones y pista del gesto. Un tap sobre una fila abierta la
  cierra en lugar de conectar accidentalmente.
- Búsqueda/quick connect/licencias: taps y desplazamiento con teclado; salida
  visible. Terminal: botón para desenfocar xterm y ocultar teclado, teclas de
  48 puntos, confirmación de pegado con zona segura/adaptación al teclado.

## Verificación y límites

TypeScript/lint/Jest y exportación Hermes se comprueban antes de la beta.
La geometría real del teclado de iOS, el gesto y el selector de archivos deben
revalidarse en el iPhone con la nueva build; una exportación no los ejecuta.
No se ha instalado un SDK Android ni un simulador local.

Prueba dirigida: pegar un config de tres hosts en Add Host; reimportarlo sin
crear duplicados; editar un campo inferior con teclado numérico; abrir privada
luego pública (.pub); guardar sin cerrar manualmente el teclado; deslizar una
fila, cancelar borrado y editar; ocultar el teclado del terminal sin desconectar.
Repetir con texto ampliado y en una pantalla pequeña.

Referencias oficiales:
- https://reactnative.dev/docs/scrollview
- https://reactnative.dev/docs/keyboardavoidingview
- https://docs.swmansion.com/react-native-gesture-handler/docs/components/reanimated_swipeable/
