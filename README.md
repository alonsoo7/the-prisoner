# the-prisoner

Repositorio del proyecto de **Seminario 1 | Agentes Inteligentes**, centrado en el Dilema del Prisionero Iterado (IPD) y la evolución de agentes desde modelos miopes y búsqueda Expectimax hasta Aprendizaje por Refuerzo Online basado en Procesos de Decisión de Markov (MDP).

---

## Estructura del proyecto

- **`taller5_web/`** — Aplicación web interactiva (servidor HTTP en Python + frontend en HTML/CSS/JS) para visualizar la evolución de los agentes, explorar el modelo MDP, jugar partidas humano vs. agente, ejecutar torneos y revisar el código fuente en vivo.
  - `server.py` / `run_web.sh`: servidor HTTP local (por defecto en `http://127.0.0.1:8055`).
  - `core/`: motor de simulación y generación de partidas (`engine.py`, `generations.py`, `agents.py`, `ipd_mdp.py`, `plot_learning.py`, `run_experiment.py`, `test_ipd.py`).
  - `static/`: interfaz web (`index.html`, `app.js`, `charts.js`, `voxel.js`, `styles.css`).
  - `axelrod_ring_cache.json` / `freq_cache.json`: cachés precalculados para carga rápida en la web.
- **Modelo MDP y agentes (`ipd_mdp.py`, `agents.py`)** — Definición de estados, matriz de pagos, tabla de frecuencias empírica, solver de Bellman e implementación de los agentes MDP/RL compatibles con `axelrod.Player`.
- **Generación de partidas, torneos y experimentos**:
  - `run_experiment.py`: cálculo de tabla de frecuencias sobre el pool de 30 estrategias, resolución de Bellman, trazas contra `Defector` y evaluación en Axelrod 1980.
  - `run_tournaments_10seeds_and_harper.py` y `tournaments_10seeds_and_harper.json`: generación de partidas y torneos comparativos (Axelrod 10 semillas, benchmark de Harper y mega-torneo) para todas las generaciones de agentes.
  - `run_jacinto_taller6.py`: evaluación comparativa del agente **Jacinto** (`SafeUCBForgettingRLAgent`, Taller 6).
  - `plot_learning.py`: utilidades de graficación y rivales sintéticos (`CooperateThenDefect`, `ThreePhaseRival`) para medir adaptación ante oponentes no estacionarios.
  - `test_ipd.py`: pruebas unitarias del MDP, agentes y torneos.
  - `evolucion_agentes_taller5.ipynb` y `markov.ipynb`: notebooks de análisis y experimentación.
- **`taller/`** — Documentos PDF de los talleres previos ([ver `taller/readme.md`](taller/readme.md)).

---

## Cómo funcionan los agentes

El entorno modela el IPD como un **MDP memory-1** con 4 estados $s \in \{\text{CC}, \text{CD}, \text{DC}, \text{DD}\}$ (última jugada propia y del oponente) y 2 acciones $A \in \{C, D\}$, con matriz de pagos estándar de Axelrod: $(C,C) \to 3$, $(C,D) \to 0$, $(D,C) \to 5$, $(D,D) \to 1$.

### 1. `RulitoMiope` — Etapa I (`taller5_web/core/generations.py`, `run_tournaments_10seeds_and_harper.py`)
- **Idea**: agente frecuentista **miope** ($\gamma = 0$) que solo maximiza la recompensa inmediata.
- **Funcionamiento**:
  - Durante los primeros `exploration_turns` (por defecto 10), alterna entre cooperar y traicionar para poblar conteos por estado.
  - Luego estima $p_c = P(O_t = C \mid s_{t-1})$ con los conteos observados y compara $Q(C) = 3 p_c$ contra $Q(D) = 4 p_c + 1$. Como $4p_c + 1 > 3p_c$ para todo $p_c \in [0, 1]$, tiende a traicionar al ignorar la respuesta futura del rival.

### 2. `CloudOneStep` — Etapa II (`taller5_web/core/generations.py`, `run_tournaments_10seeds_and_harper.py`)
- **Idea**: agente con horizonte corto (**1-Step Lookahead**, $\gamma = 0.90$).
- **Funcionamiento**:
  - Usa una fase inicial de exploración alternante y estima probabilidades de transición **no condicionadas a su propia acción**, $P(O_t \mid s_{t-1})$.
  - Evalúa un paso hacia adelante con descuento $\gamma$, pero al no distinguir cómo su propia acción $A_t$ cambia la probabilidad de respuesta del oponente, su capacidad para sostener cooperación estratégica sigue siendo limitada.

### 3. `ExpectimaxMarkovAgent` ("Gary") — Etapa III (`taller5_web/core/generations.py`, `run_tournaments_10seeds_and_harper.py`)
- **Idea**: planificación mediante árbol **Expectimax** de horizonte finito ($H = 4$, 256 hojas) combinado con una heurística terminal de Cadena de Markov.
- **Funcionamiento**:
  - Mantiene el vector empírico $E[s]$ de cooperación del rival por estado.
  - Expande el árbol de decisiones hasta profundidad $H = 4$ alternando nodos de decisión propios ($\max$) y nodos de azar del oponente (expectativa según $E[s]$).
  - En las hojas evalúa la ecuación cerrada de Bellman para una Cadena de Markov inducida por TFT: $(I - \gamma P_{\text{TFT}})^{-1} P_{\text{TFT}} R$.

### 4. `EmpiricalPolicyAgent` — Política fija offline (`agents.py`, `ipd_mdp.py`)
- **Idea**: agente **memory-1 fijo** derivado del modelo MDP completo ($8 \times 4$ transiciones $(s_{t-1}, A_t) \to s_t$).
- **Funcionamiento**:
  - `collect_frequency_table()` simula partidas sobre un pool diverso de 30 estrategias de Axelrod (`build_training_pool()`) para estimar $P(O_t = C \mid s_{t-1}, A_t)$ y construir la matriz de transición $8 \times 4$.
  - `solve_bellman()` calcula $V^*(s)$, $Q^*(s, a)$ y la política óptima $\pi_0[s]$.
  - En partida, coopera en el turno 1 y luego aplica $\pi_0[s_{t-1}]$ sin actualizar su modelo.

### 5. `BayesianFrequencyRLAgent` — RL Bayesiano puro (`agents.py`)
- **Idea**: agente de **Aprendizaje por Refuerzo Online Bayesiano** (Beta-Bernoulli) que parte del prior empírico de la Etapa 4 y se adapta al oponente actual.
- **Funcionamiento**:
  - Inicializa distribuciones $\text{Beta}(\alpha, \beta)$ por cada contexto $(s_{t-1}, A_t)$ con peso $M_0$ (`prior_strength = 1.0`): $\alpha = M_0 p_{\text{prior}}$, $\beta = M_0 (1 - p_{\text{prior}})$.
  - En cada turno completo $(s_{t-1}, A_t) \to O_t$, aplica la actualización conjugada: suma `+1` a $\alpha$ si el rival cooperó o `+1` a $\beta$ si traicionó.
  - Recalcula las probabilidades posteriores $\alpha / (\alpha + \beta)$ y vuelve a resolver Bellman online en cada turno.

### 6. `ForgettingTransitionRLAgent` — RL Online con Matriz Incremental y Olvido (`agents.py`)
- **Idea**: adaptación rápida ante **oponentes no estacionarios** (estrategias que cambian de comportamiento durante la partida, como `CooperateThenDefect` o `ThreePhaseRival`).
- **Funcionamiento**:
  - Mantiene explícitamente la matriz de transición $8 \times 4$ y un contador efectivo $n(s, a)$ inicializado en $n_0$.
  - En cada observación aplica decaimiento exponencial con factor de olvido $\lambda \in [0, 1]$:
    $$n \leftarrow \lambda n + 1, \qquad \eta = \frac{1}{n}$$
  - Actualiza la fila de la matriz con $P \leftarrow (1 - \eta) P + \eta \cdot \mathbf{1}_{s_{\text{next}}}$ y re-resuelve Bellman en cada turno. A diferencia del conteo puro, $\eta$ no decae a $0$, permitiendo olvidar transiciones antiguas.

### 7. `SafeUCBForgettingRLAgent` ("Jacinto") — Etapa VI (`agents.py`, `run_jacinto_taller6.py`)
- **Idea**: extensión híbrida de `ForgettingTransitionRLAgent` con **exploración segura basada en UCB** (*Upper Confidence Bound*).
- **Funcionamiento**:
  - Utiliza la misma actualización incremental con olvido $\lambda$ y planificación Bellman.
  - **Compuerta de exploración segura (*Safe Exploration Gate*)**: si el estado actual es `CC` (`current_s == 0`) y la probabilidad estimada de que el rival siga cooperando al cooperar es $\ge 0.85$ (`safe_cc_threshold`), **nunca explora traicionar** y sigue directamente la política de Bellman.
  - Fuera de esa condición segura, selecciona la acción maximizando:
    $$Q^*(s, a) + c \sqrt{\frac{\ln(t + 1)}{1 + N(s, a)}}$$
    balanceando explotación y exploración en estados sub-visitados (`CD`, `DC`, `DD`).

---

## Cómo ejecutar

### Requisitos
Python 3.10+ con las dependencias del proyecto:

```bash
pip install axelrod numpy matplotlib
```

### 1. Levantar la página web interactiva (`taller5_web`)
```bash
bash taller5_web/run_web.sh
# o indicando otro puerto:
python3 taller5_web/server.py --host 127.0.0.1 --port 8055
```
Luego abre `http://127.0.0.1:8055` en el navegador.

### 2. Generar partidas, torneos y experimentos por CLI
```bash
# Tabla de frecuencias, Bellman y evaluación Axelrod 1980
python3 run_experiment.py

# Torneos comparativos (10 semillas Axelrod, Harper y mega-torneo)
python3 run_tournaments_10seeds_and_harper.py

# Evaluación de Jacinto (Taller 6)
python3 run_jacinto_taller6.py
```

### 3. Ejecutar pruebas unitarias
```bash
python3 -m unittest test_ipd.py -v
```
