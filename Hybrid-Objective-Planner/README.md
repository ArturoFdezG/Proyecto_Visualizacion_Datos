# Demo de Hybrid Objective Planner

## Descripción general
Este demo expone un planificador ligero para combinar objetivos de entrenamiento y mostrar información sobre interferencias e insights fisiológicos. Incluye datos estáticos extraídos de la carpeta `data/` y un backend pequeño en Python que sirve tanto los recursos como los helpers JSON utilizados por las visualizaciones del front-end.

## Estructura de archivos
- `index.html` – Diseño de una sola página que organiza el catálogo de objetivos, controles de disponibilidad y paneles de análisis. Carga Chart.js y el módulo JavaScript principal.
- `styles.css` – Estilos con tema oscuro, grid de diseño y estilos de componentes para la UI del planificador (tarjetas de catálogo, paneles de insights, modales, etc.).
- `app.js` – Controlador JavaScript vanilla que carga el catálogo, gestiona selecciones, orquesta llamadas a la API y renderiza widgets como el gráfico radar, termómetro de interferencia y listas de resumen.
- `app.py` – **Aplicación FastAPI principal** para despliegue en producción. Sirve recursos estáticos e implementa los endpoints POST `/api/interference` y `/api/radar`. Usa esto para el despliegue en Render.
- `server.py` – Wrapper legacy con `http.server` que sirve los recursos estáticos e implementa los endpoints POST `/api/interference` y `/api/radar`. Útil para desarrollo local sin dependencias.
- `interference_api.py` / `physiology_api.py` – Servicios FastAPI opcionales independientes que exponen endpoints GET de solo lectura (`/interference` y `/physiology`) para los mismos datasets cuando se despliega detrás de un servidor ASGI.
- `requirements.txt` – Dependencias de Python necesarias para la aplicación FastAPI.
- `data/objectives.json` – Catálogo de objetivos agrupados por categoría con metadatos descriptivos y sugerencias de tiempo semanal mínimo.
- `data/objectives_disciplines_weights.json` – Ponderaciones de disciplinas por objetivo utilizadas para construir el balance fisiológico combinado.
- `data/interference_results.jsonl` – Puntuaciones de interferencia precalculadas para pares y tríos más desgloses cualitativos.
- `data/physiological_results.jsonl` – Valores de ejes agregados para el gráfico radar y resumen de balance.

## Arquitectura
El front-end es una SPA estática construida con HTML/CSS/JS plano. El estado se rastrea en un objeto `state` compartido y se renderiza de forma declarativa mediante funciones helper del DOM. Los paneles de análisis consumen respuestas JSON del backend de Python y las alimentan a widgets de UI como gráficos radar de Chart.js, termómetros y listas de resumen. El backend actúa como una capa adaptadora entre el navegador y los datasets pre-generados, validando IDs de objetivos y devolviendo payloads formateados.

## Funcionalidad
- Ajusta el tiempo semanal disponible y ve feedback en tiempo real sobre las horas comprometidas relativas a los requisitos del catálogo.
- Navega por el catálogo de objetivos, selecciona hasta tres objetivos por plan y captura selecciones opcionales de enfoque de competición.
- Solicita análisis de interferencia para pares/tríos, incluyendo razones cualitativas, etiquetado de severidad y flags de redundancia mostrados en la UI.
- Renderiza un perfil fisiológico combinado en un gráfico radar junto con desgloses porcentuales y resúmenes narrativos.
- Genera sugerencias de entrenamiento contextuales basadas en la mezcla de selecciones, incluyendo cuando faltan datos o se exceden límites.

## Ejecutar el demo

### Opción 1: Aplicación FastAPI (Recomendada para producción)

1. Crea un entorno virtual:
   ```bash
   # Linux/Mac
   python3 -m venv venv
   source venv/bin/activate
   
   # Windows
   python -m venv venv
   venv\Scripts\activate
   ```

2. Instala las dependencias:
   ```bash
   pip install -r requirements.txt
   ```

3. Ejecuta la aplicación:
   ```bash
   python app.py
   ```

4. Abre `http://localhost:8000/` en tu navegador. Ajusta objetivos y disponibilidad para ver cómo se actualizan los análisis.

### Opción 2: Servidor HTTP Legacy

1. Desde este directorio, lanza el servidor incorporado: `python server.py` (sirve archivos estáticos y APIs POST en el puerto 8000).
2. Abre `http://localhost:8000/` en un navegador.

### Opción 3: Servicios FastAPI Independientes

Inicia los endpoints FastAPI con `uvicorn interference_api:app --reload` o `uvicorn physiology_api:app --reload` para integrar con otros front-ends.
