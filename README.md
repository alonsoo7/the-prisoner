# the-prisoner

Repositorio del proyecto de **Seminario 1 | Agentes Inteligentes**, centrado en el **Dilema del Prisionero Iterado (IPD)** y la evolución de agentes desde modelos miopes y búsqueda Expectimax hasta **Aprendizaje por Refuerzo Online** basado en Procesos de Decisión de Markov (MDP) con factor de olvido (**Mitcha**).

- **Demo interactiva en vivo:** [https://ajta.tech/ipd/](https://ajta.tech/ipd/)
- **Informe Taller 5 (Mitcha):** [`taller.pdf`](taller.pdf)
- **Referencia Expectimax (Gary, $H = 2, \gamma = 0.90$):** [`gary_expectimax.pdf`](gary_expectimax.pdf)

---

## Estructura del proyecto

- **`taller5_web/`** — Aplicación web interactiva (servidor HTTP en Python + frontend en HTML/CSS/JS con KaTeX, DOMPurify y arena voxel) para jugar humano vs. IA, explorar el Torneo de Axelrod (1980), inspeccionar el modelo MDP ($8 \times 4$), simular la regla de olvido ($n_0, \lambda, \eta_k$) paso a paso, visualizar el árbol Expectimax de Gary ($H = 2$, 16 hojas), ejecutar torneos y revisar el código fuente en vivo.
  - `server.py` / `run_web.sh`: servidor HTTP (por defecto en `http://127.0.0.1:8055`).
  - `core/`: motor de simulación, sesiones y agentes (`engine.py`, `generations.py`, `agents.py`, `ipd_mdp.py`, `plot_learning.py`, `run_experiment.py`, `session_store.py`, `test_ipd.py`).
  - `static/`: interfaz web (`index.html`, `app.js`, `charts.js`, `voxel.js`, `styles.css`, `katex/`, `fonts/`, `purify.min.js`, `veritasium_thumb.jpg`).
  - `axelrod_ring_cache.json` / `freq_cache.json`: cachés precalculados para carga instantánea.
- **Modelo MDP y agentes (`ipd_mdp.py`, `agents.py`)** — Definición de estados, matriz de pagos, tabla empírica ($173{,}130$ transiciones), solver de Bellman ($\Delta V \le 10^{-6}$) e implementación de agentes compatibles con `axelrod.Player`.
- **Experimentos, notebooks y reportes**:
  - `taller.pdf` y `gary_expectimax.pdf`: informe formal del Taller 5 y documento técnico de referencia de Gary.
  - `evolucion_agentes_taller5.ipynb` y `markov.ipynb`: notebooks reproducibles de análisis y experimentación.
  - `run_experiment.py`, `run_tournaments_10seeds_and_harper.py`, `run_jacinto_taller6.py`, `plot_learning.py`, `test_ipd.py`.
  - `tournaments_10seeds_and_harper.json`: resultados verificados de Axelrod 1980 (10 semillas), Harper (37 estrategias) y Mega-Torneo (171 estrategias).
  - `Dockerfile`, `docker-compose.yml`, `requirements.txt`: empaquetado reproducible en contenedor no-root.
- **`taller/`** — Documentos PDF de los talleres previos ([ver `taller/readme.md`](taller/readme.md)).

---

## Cómo funcionan los agentes

El entorno modela el IPD como un **MDP memory-1** con 4 estados $s \in \{\text{CC}, \text{CD}, \text{DC}, \text{DD}\}$ (última jugada propia y del oponente) y 2 acciones $A \in \{C, D\}$, con pagos estándar de Axelrod: $(C,C) \to 3$, $(C,D) \to 0$, $(D,C) \to 5$, $(D,D) \to 1$.

### 1. `Cloud` (Etapa I) y `Rulito` (Etapa II) — `taller5_web/core/generations.py`
- **Cloud (miope, $\gamma = 0$)**: maximiza solo el pago inmediato estimando $P(O_t = C \mid s_{t-1})$ sin valorar la reacción futura.
- **Rulito (1-Step Lookahead, $\gamma = 0.90$)**: evalúa un paso hacia adelante pero sin condicionar la respuesta del rival a su propia acción $A_t$.

### 2. `ExpectimaxMarkovAgent` ("Gary") — Referencia Expectimax (`taller5_web/core/generations.py`, [`gary_expectimax.pdf`](gary_expectimax.pdf))
- Planificación mediante árbol **Expectimax** de horizonte $H = 2$ ($\gamma = 0.90$, 16 hojas) con evaluación terminal exacta por Cadena de Markov inducida por Tit For Tat:
  $$\vec{V}_{\text{TFT}} = (I - \gamma P_{\text{TFT}})^{-1} P_{\text{TFT}} \vec{R}.$$
- Mantiene en línea el vector empírico $E[s]$ de cooperación del rival por estado y actualiza la política en cada turno.

### 3. `EmpiricalPolicyAgent` ("Base CDDC") — Política fija offline (`agents.py`, `ipd_mdp.py`)
- Estima la matriz de transición empírica $T_0$ ($8 \times 4$, sobre $173{,}130$ transiciones) en un pool de 30 estrategias y resuelve Bellman exacto ($\gamma = 0.90$, $\Delta V \le 10^{-6}$), obteniendo la política fija $\pi_0 = \mathrm{CDDC}$ (*Win-Stay, Lose-Shift*).

### 4. `ForgettingTransitionRLAgent` ("Mitcha") — Agente central del Taller 5 (`agents.py`, [`taller.pdf`](taller.pdf))
- Parte de $T_0$ con peso inicial $n_0 = 2.0$ y actualiza las probabilidades de transición en línea mediante contador efectivo con factor de olvido $\lambda = 0.90$:
  $$n_k = \lambda n_{k-1} + 1, \qquad \eta_k = \frac{1}{n_k},$$
  $$p_k = \begin{cases} p_{k-1} + \eta_k (1 - p_{k-1}) & \text{si } O_t = C \\ p_{k-1} - \eta_k p_{k-1} & \text{si } O_t = D \end{cases}$$
- El olvido impone un techo exacto $n_\infty = \frac{1}{1-\lambda} = 10$, garantizando que cada jugada reciente pese al menos $\eta_\infty = 10\%$ incluso tras decenas de rondas (evitando que el agente quede congelado ante rivales no estacionarios).
- Alcanza **#1/16 ($2.650 \pm 0.018$, 100% #1)** en Axelrod 1980 (10 semillas) y asciende **+78 puestos** en el Mega-Torneo de 171 estrategias (#99 $\to$ #21).

### 5. `SafeUCBForgettingRLAgent` ("Jacinto") — Taller 6 (`agents.py`, `run_jacinto_taller6.py`)
- Extensión de `ForgettingTransitionRLAgent` con exploración segura basada en UCB y compuerta de protección en `CC`.

---

## Cómo ejecutar

### Opción A — Docker (igual que el servidor de producción)
```bash
docker compose up --build
```
Luego abre `http://127.0.0.1:8055` en el navegador.

### Opción B — Ejecución local con Python
Requisitos: Python 3.10+ (`pip install -r requirements.txt`).

```bash
bash taller5_web/run_web.sh
# o indicando otro puerto:
python3 taller5_web/server.py --host 127.0.0.1 --port 8055
```
Luego abre `http://127.0.0.1:8055`.

### Scripts y pruebas unitarias
```bash
# Pruebas unitarias del MDP, agentes y reglas de actualización
python3 -m unittest test_ipd.py -v

# Tabla empírica, Bellman y evaluación Axelrod 1980
python3 run_experiment.py
```
