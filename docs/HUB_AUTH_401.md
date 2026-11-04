# Acceso del Hub desde Codespaces

El token del mismo Agent tiene prioridad sobre cualquier modo cloud guardado,
incluso cuando un HTML anterior solo inyectó `__IMPULSOR_AGENT_TOKEN__` y no
`__IMPULSOR_SAME_ORIGIN__`. Antes, con modo cloud antiguo y sin token cloud,
`activeToken()` ignoraba el token inyectado y las peticiones salían sin Bearer.
La regresión reproduce el mensaje 401 original usando ese estado.

Esto demuestra una causa reproducible en el código; no demuestra qué versión
estaba ejecutándose en un Codespace al que no se tuvo acceso.

El arranque reconstruye el frontend del checkout, registra su huella de fuentes,
rechaza un dist desactualizado en Codespaces y verifica PID/revisiones del proceso
que responde en 8000. Ya no ejecuta reset ni borra cambios locales. El import de
FastAPI tampoco intenta compilar silenciosamente ni reutiliza una compilación
fallida como si estuviera actualizada.

## Acceso seguro desde el celular

Una URL pública y el mismo origen no autentican al propietario. Por eso el HTML
remoto nunca contiene el token del servidor. El arranque muestra en la terminal
un enlace privado con una capacidad en el fragmento (`/#impulsor-token=...`).
El navegador inicializa el token antes de cargar los módulos, quita el fragmento
de la barra de direcciones y guarda la sesión solo en esa pestaña. No envía el
fragmento al servidor ni a sus logs. Abrir ese enlace entra al Hub sin selección,
dirección ni formulario de código. Recargar la misma pestaña conserva el acceso.
Cerrar la pestaña, borrar su almacenamiento o rotar el token requiere abrir de
nuevo el enlace privado. No compartirlo: concede acceso al Agent.

No se confía en el nombre de dominio, cabeceras de proxy ni una presunción de
puerto privado para entregar credenciales. El puerto puede mantenerse privado
como protección adicional. Un visitante público sin capacidad sigue sin poder
consultar proyectos ni crear el proyecto de prueba. Los accesos remotos mediante
código siguen disponibles y conservan su Bearer y URL propios.

## Despliegue desde Android sin terminal

El workflow **Deploy Hub to existing Codespace** solicita autorización de GitHub
CLI en el navegador y después se conecta únicamente al Codespace existente del
propietario para este repositorio. No crea un Codespace ni publica el puerto.
La conexión requiere que el Codespace acepte el túnel SSH de GitHub CLI; hasta
comprobar esa conexión y las operaciones HTTP reales no se declara desplegado.

La ejecución utiliza un worktree aislado y fijado al commit revisado. Conserva
la rama, archivos y cambios del checkout del usuario. Compila, reinicia solo el
Agent, verifica revisión/PID, carga HTML/assets, comprueba 401 anónimo y prueba
listado/creación/lectura autenticados. Los fallos detienen la operación.

La autorización utiliza los permisos normales de GitHub CLI más `codespace`;
las credenciales quedan en el runner efímero y no se guardan en el repositorio.
El estado del commit enlaza al paso de autorización. El enlace de acceso del Hub
se devuelve cifrado con RSA-OAEP a la clave pública de esta sesión, para que no
quede expuesto en los logs o informes públicos. La clave privada permanece fuera
del repositorio y se necesita para recuperar el enlace. Esta sesión recupera el
informe y entrega el enlace privado al propietario después de verificarlo.

## Validación reproducible

Con Python y Node 24:

```sh
python -m unittest discover -s tests -p test_hub_auth_regression.py -v
```

Son cinco pruebas Python y siete pruebas del JavaScript de los clientes reales.
La integración usa HTTPX/ASGI, una base temporal y el endpoint real de creación
del proyecto de prueba. El puente por stdin/stdout permite ejecutarla sin abrir
sockets. Comprueba apertura del HTML, bootstrap antes del bundle, ausencia de
token en HTML/assets públicos, aislamiento del modo remoto, todas las operaciones
de los clientes, listado, creación y consulta tras recargar la sesión. No ejecuta
Godot ni proveedores de IA. No equivale a pulsar el botón en un navegador móvil.

El workflow `Hub authentication regression` también instala dependencias y
compila el frontend real. La validación manual pendiente en el Codespace activo
es abrir el enlace, comprobar la ausencia de selección, pulsar **USAR PROYECTO DE
PRUEBA** y recargar. Solo esa comprobación permite confirmar el despliegue real.
