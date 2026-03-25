# Embed Recommendation Algorithms Language

Embed Studio DSL
search, features, scoring, and ranking.

## Install

```bash
npm install algo-dsl
```

## Setup

```javascript
import { StudioConfig, StudioV1 } from 'algo-dsl';

const config = new StudioConfig({ apiKey: 'YOUR_API_KEY' });
const mbd = new StudioV1({ config });
```

## Usage

### Set the target user for personalization
```javascript
const polymarketWallet = '0x123...';
mbd.forUser("polymarket-wallets", polymarketWallet);
```

### Generate candidates

Search your mbd indices using inclide/exclude filters and boosting options.

```javascript
const candidates = await mbd.search()
  .index("polymarket-items")
  .includeVectors(true)
  .include()
  .numeric("volume_1wk", ">=", 10000)
  .exclude()
  .term("closed", true)
  .term("price_under05_or_over95", true)
  .boost()
  .groupBoost("polymarket-wallets", "ai_labels_med", polymarketWallet, "label", 1, 5, 10)
  .groupBoost("polymarket-wallets", "tags", polymarketWallet, "tag", 1, 5, 10)
  .execute();
```

### Add candidates to current context

Attach the search results to the SDK so later steps can use them.

```javascript
mbd.addCandidates(candidates);
```

### Enrich your data

Fetch features (signals, metadata) for each candidate.

```javascript
const features = await mbd.features("v1")
  .execute();
mbd.addFeatures(features);
```

### Run predictive and reranking AI models

Score candidates with ML models for relevance or reranking.

```javascript
const scores = await mbd.scoring()
  .model("/scoring/ranking_model/polymarket-rerank-v1")
  .execute();
mbd.addScores(scores, "rerank_polymkt1");
```

### Combine all the data into final recommendations

Merge signals and produce the final ranked list with diversity and limits.

```javascript
const ranking = await mbd.ranking()
  .sortingMethod('mix')
  .mix("topic_score", 'desc', 40)
  .mix("user_affinity_score", 'desc', 40)
  .mix("rerank_polymkt1", 'desc', 20)
  .diversity('semantic')
  .lambda(0.5)
  .horizon(20)
  .limitByField()
  .every(10)
  .limit("cluster_1", 1)
  .execute();
mbd.addRanking(ranking);
```

## API

| Method | Description |
|--------|-------------|
| `forUser(index, userId)` | Set user context for personalization |
| `search()` | Build and run a search query |
| `frequentValues(index, field, size?)` | Fetch frequent values in an index/field (default size: 25) |
| `addCandidates(array)` | Add search hits to the current context |
| `features(version)` | Fetch features for candidates |
| `addFeatures(result)` | Attach features to candidates |
| `scoring()` | Run scoring/reranking models |
| `addScores(result, key)` | Attach model scores to candidates |
| `ranking()` | Produce final ranked recommendations |
| `addRanking(result)` | Attach ranking scores to candidates |

## Useful links

- **Examples:** [https://github.com/ZKAI-Network/mbd_studio_demo](https://github.com/ZKAI-Network/mbd_studio_demo)
- **Embed Studio webapp:** [https://api.mbd.xyz/v3/studio/frontend/](https://api.mbd.xyz/v3/studio/frontend/)
