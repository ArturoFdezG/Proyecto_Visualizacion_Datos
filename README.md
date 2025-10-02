# Proyecto_Visualizacion_Datos

## Descripción
Este repositorio contiene el desarrollo del core de una app de entrenamiento inteligente, diseñada para quienes combinan fuerza, resistencia y otras disciplinas sin sacrificar resultados.  
El sistema se basa en un conjunto de motores de decisión y adaptación que personalizan cada plan, minimizan la interferencia entre modalidades y se ajustan en tiempo real a la vida del usuario.  

La propuesta es clara: un entrenador digital que optimiza tu camino hacia los objetivos, se adapta a tus circunstancias y te educa en el proceso.  

## Problema que resuelve
- La mayoría de apps actuales cubren una sola disciplina (solo correr, solo fuerza).  
- No existe quien reorganice el plan en tiempo real cuando cambian tus condiciones (imprevistos, fatiga, viajes).  
- Faltan explicaciones claras sobre el “por qué” de cada decisión.  
- Los usuarios que entrenan híbrido caen en ensayo-error, con riesgo de frustración, estancamiento o lesiones.  

## Propuesta de valor
- Un sistema capaz de ser tan sencillo o avanzado como el usuario lo desee.  
- Planificación híbrida que integra fuerza, resistencia, movilidad y más.  
- Reorganización automática cuando cambian tus circunstancias.  
- Explicaciones adaptadas al nivel de detalle que quieras (básico o avanzado).  

## Motores principales
- **Motor de Priorización de Objetivos**: traduce tus metas en un conjunto ponderado de entrenamientos.  
- **Motor de Planificación Híbrida**: genera planes óptimos según tiempo, equipamiento y restricciones.  
- **Motor de Adaptación Dinámica**: ajusta en tiempo real según fatiga, sueño, dolor o imprevistos.  
- **Motor de Aprendizaje Personal**: evoluciona tu plan con base en tu historial y progresos.  

### Motores transversales
- **Registro Inteligente**: convierte inputs libres (texto, audio, foto) en datos estructurados.  
- **Integración de Datos**: conecta con wearables y apps externas (HRV, sueño, pasos, calorías).  
- **Explicación Adaptativa**: comunica el “por qué” de cada decisión con evidencia científica.  
- **Visualización de Progreso**: muestra avances, hitos y causas de estancamiento.  

## Público objetivo
- Intermedios ambiciosos (25–40 años): quieren progresar en fuerza y resistencia a la vez.  
- Avanzados autodidactas: buscan entender la lógica y ciencia detrás del plan.  
- Profesionales ocupados: valoran la eficiencia y la reorganización automática del entrenamiento.  

## Datos utilizados
- **Estáticos**: edad, género, experiencia, historial de lesiones, equipamiento, preferencias.  
- **Dinámicos**: entrenamientos realizados, biometría, feedback subjetivo, adherencia, tendencias de progreso.  
- **De desarrollo**: estudios científicos, bases de datos públicas, datos anónimos de usuarios, logs de simulación.

## 📅 Planificación del proyecto

A continuación se detalla la planificación inicial de desarrollo de los motores principales de la app, con tareas concretas y tiempos estimados.  

<img width="2832" height="867" alt="Planificacion_inicial" src="https://github.com/user-attachments/assets/1d5948b1-3f74-4bd6-ba58-0f1d5fce1607" />

---

### Planning & Research (Septiembre)
- Recopilación de estudios científicos sobre interferencia fuerza-cardio, periodización y recuperación.  
- Revisión de datasets públicos (ej. Strava, Kaggle).  
- Definición de estructura general de motores y flujos entre ellos.  
**Output esperado:** documentación inicial y arquitectura básica de referencia.  

---

### Motor de Priorización de Objetivos (Septiembre–Octubre, ~30h)
Convierte las metas del usuario en un perfil de objetivos ponderados.  

**Tareas a desarrollar:**
- Catálogo de objetivos organizado por categorías (fuerza, resistencia, movilidad, composición corporal).  
- Librería JSON con metadatos: disciplinas asociadas, pesos, restricciones, dependencias.  
- Selección de objetivos:  
  - Opción manual → el usuario elige y pondera.  
  - Opción asistida → reglas, filtros rápidos y advertencias de incompatibilidad.  
- Algoritmo *mixer* → combina objetivos con sus pesos y devuelve un output estandarizado para el planificador.  

**Output esperado:** JSON estructurado con prioridades claras y un sistema básico de checks de viabilidad.  

---

### Motor de Planificación Híbrida (Octubre–Noviembre, ~60h)
Genera un plan semanal coherente a partir de los objetivos.  

**Tareas a desarrollar:**
- Catálogo de rutinas base por disciplina (ej. fuerza 3x/semana, resistencia 4x/semana).  
- Catálogo de ejercicios con metadata: patrón de movimiento, grupo muscular, intensidad, equipamiento. Incluye equivalencias y sustituciones.  
- Reglas de interferencia: traducción de la evidencia científica a restricciones aplicables (ej. evitar HIIT tras pierna pesada).  
- Algoritmo de optimización:  
  - Semana 1 → versión básica (distribución semanal simple).  
  - Semana 2 → versión avanzada (aplicación de reglas de interferencia, checks de inviabilidad, sustituciones).  

**Output esperado:** un plan semanal en formato JSON con entrenamientos distribuidos según objetivos, restricciones y reglas.  

---

### Motor de Adaptación Dinámica (Noviembre, ~45h)
Ajusta el plan en tiempo real según inputs dinámicos del usuario.  

**Tareas a desarrollar:**
- Definición de inputs dinámicos: entrenos perdidos, fatiga subjetiva, tiempo disponible, biometría básica.  
- Reglas de adaptación:  
  - Reubicar sesiones perdidas.  
  - Reducir volumen/intensidad si hay fatiga alta.  
  - Ajustar según tiempo disponible en la semana.  
- Motor adaptador: prototipo que recibe inputs y modifica el plan semanal generado por el optimizador.  

**Output esperado:** plan semanal actualizado automáticamente tras cambios en condiciones del usuario.  

---

### Integración y Pruebas (Diciembre, ~30h)
Valida la conexión entre motores y asegura coherencia de outputs.  

**Tareas a desarrollar:**
- Integración del flujo completo: Priorización → Planificación → Adaptación.  
- Pruebas con escenarios simulados: entreno perdido, tiempo reducido, fatiga alta, objetivos en conflicto.  
- Ajustes de consistencia y documentación del comportamiento.  

**Output esperado:** MVP funcional con flujo completo, capaz de generar y adaptar planes híbridos básicos.  

## Estado actual
Este repositorio recoge la arquitectura y motores principales del sistema. El proyecto está en fase inicial de diseño y desarrollo.
