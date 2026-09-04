# Plan: survivorship, and where neural belongs

Written 2026-09-04, from Marcus by voice: *"How would we play on this idea of survivorship? I could produce a library of 10, 16, 32 examples from Midjourney that I think are pretty. To some kind of learning system to teach the system what kind of survivors we want. Maybe we need a neural approach. I would love to be able to play with neural elements as part of these pipelines inside of Cascade."*

The context is an afternoon of generated marks losing to his Midjourney picks. The diagnosis that matters: he was comparing a grid of six generated candidates against his own selection from sixty. **Selection was doing most of the work, and it was happening in his head rather than in the pipeline.**

## The claim this plan rests on

**Generate procedurally, select neurally.**

The drawing rule should stay procedural, because that is what he can steer: a field, a tracer, events, repulsion, a composition pass, each with parameters he can turn and reason about. A generative network would take that away and give him prompt-nudging instead.

Selection is the opposite. Nobody can write down what makes one of these marks better than another — that is exactly the kind of judgement a model can carry and a person cannot articulate. So the loop is: procedural generator, learned judge, human confirming the shortlist.

This also satisfies the project's own law that every generative parameter must trace to evidence. A learned scorer invents no parameters. It only chooses among candidates whose parameters are all traceable.

## Three levels of judge, in the order they should be built

### 1. Rejection filters, hand-written, no learning

Ink coverage bounds, mid-grey fraction after downsampling, stroke count, minimum separation. These are not taste and should not pretend to be. Their job is to throw away the illegible before anything expensive looks at it — a candidate that is a grey smudge at 32px is not a matter of opinion.

Cheap, transparent, and worth having first because they cut the candidate pool by most of itself.

### 2. A preference model over interpretable features — the honest answer at his data scale

Sixteen liked images will not train a network. They will comfortably fit a linear preference model over a dozen features, and a **Bradley-Terry** model on pairwise comparisons matches how he actually judges: *this one, not that one.*

Features worth extracting from the geometry, not the pixels — the generator has the curves, so use them:

- **curvature autocorrelation length**, which is the non-stationarity that separates a drawn line from a sine wave
- curvature mean and variance
- stroke count, total ink length, dot-to-line ratio
- nearest-neighbour distance distribution between lines (the nesting)
- spectral energy per band along each line (lazy versus busy)
- bounding-box fill, and mass distribution across thirds (composition)
- count of discrete incidents: stops, hooks, spawns

Every one of those is computable in a node, deterministically, from the geometry Cascade already carries.

The payoff beyond ranking: **the model explains itself.** A fitted linear model says *your picks have an autocorrelation length around a third of the frame and a dot-to-line ratio near 1:4* — which is a sentence about his taste he can argue with, and which then feeds back into the generator's parameter ranges. A black box cannot do that.

Data collection starts now and costs nothing: every sheet of six where he says *"3 is the one"* is five labelled pairs. Nine such rounds is about fifty comparisons, which is enough.

### 3. A pretrained embedding, for the gestalt the features miss

A pretrained image encoder needs no training at all: embed the liked set, embed each candidate, score by distance to the liked centroid — or better, distance to the liked set minus distance to a rejected set, which is a much stronger signal and he has rejects in quantity.

What it buys: overall feel, which no hand-written feature list captures. What it costs: it rewards *resembling the references* rather than being good, and it cannot say why. So it belongs as one weighted term beside the interpretable model, not as the judge.

## What this needs from Cascade, as nodes

- **`variants`** — re-run the upstream subgraph N times with different seeds and collect the results. This is the one real engine change: the runtime has to be able to evaluate a subgraph repeatedly with a varying input, which it currently has no notion of.
- **`features`** — geometry to feature vector. Pure, deterministic, `runsOn: portable`.
- **`taste`** — holds a fitted model, scores candidates. Reads its coefficients from a project file so the model is a project asset rather than hidden state.
- **`select`** — top K, a contact sheet, and a chosen candidate output that can drive the parameters of the next run.
- **`embed`** — the neural term, a server capability calling a local model.

The interesting consequence: **his taste becomes a file in the project, and it compounds.** Every choice adds a labelled pair. That is a durable asset of exactly the kind the studio's positioning talks about, and it is his rather than a vendor's.

## Where the corpus already exists

Substrate holds his references with tags and vision captions, and the Observatory channel is full of the kind of image this model wants as positives. The liked set does not have to be assembled by hand — it can be a Substrate query.

## What I would not do

Train a generative model on sixteen images. It would overfit to those sixteen and produce copies, and it would replace the parameters he can steer with a prompt he cannot.
