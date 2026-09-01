/**
 * Minimal L2-regularised logistic regression trained by full-batch gradient
 * descent. Small enough to read, real enough to actually fit: features are
 * z-score standardised, the loss is monitored, and the model is scored on a
 * held-out split so the API can publish honest metrics.
 */
import { sigmoid } from './geo.js';

export class LogisticRegression {
  constructor({ lr = 0.35, epochs = 900, l2 = 1e-3 } = {}) {
    this.lr = lr;
    this.epochs = epochs;
    this.l2 = l2;
    /** @type {number[]} */ this.w = [];
    this.b = 0;
    /** @type {number[]} */ this.mean = [];
    /** @type {number[]} */ this.std = [];
    this.trained = false;
  }

  _standardise(X) {
    const n = X.length;
    const d = X[0].length;
    this.mean = Array(d).fill(0);
    this.std = Array(d).fill(0);
    for (const row of X) for (let j = 0; j < d; j++) this.mean[j] += row[j] / n;
    for (const row of X)
      for (let j = 0; j < d; j++) this.std[j] += (row[j] - this.mean[j]) ** 2 / n;
    for (let j = 0; j < d; j++) this.std[j] = Math.sqrt(this.std[j]) || 1;
  }

  _z(row) {
    return row.map((v, j) => (v - this.mean[j]) / this.std[j]);
  }

  fit(X, y) {
    const n = X.length;
    const d = X[0].length;
    this._standardise(X);
    const Z = X.map((r) => this._z(r));
    this.w = Array(d).fill(0);
    this.b = 0;

    let loss = 0;
    for (let epoch = 0; epoch < this.epochs; epoch++) {
      const gw = Array(d).fill(0);
      let gb = 0;
      loss = 0;
      for (let i = 0; i < n; i++) {
        let z = this.b;
        for (let j = 0; j < d; j++) z += this.w[j] * Z[i][j];
        const p = sigmoid(z);
        const err = p - y[i];
        for (let j = 0; j < d; j++) gw[j] += (err * Z[i][j]) / n;
        gb += err / n;
        const eps = 1e-12;
        loss -= (y[i] * Math.log(p + eps) + (1 - y[i]) * Math.log(1 - p + eps)) / n;
      }
      for (let j = 0; j < d; j++) {
        this.w[j] -= this.lr * (gw[j] + this.l2 * this.w[j]);
      }
      this.b -= this.lr * gb;
    }
    this.finalLoss = loss;
    this.trained = true;
    return this;
  }

  predictProba(row) {
    const z = this._z(row);
    let s = this.b;
    for (let j = 0; j < this.w.length; j++) s += this.w[j] * z[j];
    return sigmoid(s);
  }

  /** Accuracy, precision, recall and ROC-AUC on a held-out set. */
  evaluate(X, y) {
    const scored = X.map((row, i) => ({ p: this.predictProba(row), y: y[i] }));
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const { p, y: yi } of scored) {
      const hat = p >= 0.5 ? 1 : 0;
      if (hat === 1 && yi === 1) tp++;
      else if (hat === 1 && yi === 0) fp++;
      else if (hat === 0 && yi === 0) tn++;
      else fn++;
    }
    // ROC-AUC via the Mann-Whitney U statistic on ranked scores.
    const sorted = [...scored].sort((a, b) => a.p - b.p);
    let rank = 1, i = 0, rankSumPos = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j++;
      const avgRank = (rank + (rank + (j - i))) / 2;
      for (let k = i; k <= j; k++) if (sorted[k].y === 1) rankSumPos += avgRank;
      rank += j - i + 1;
      i = j + 1;
    }
    const nPos = tp + fn;
    const nNeg = tn + fp;
    const auc = nPos && nNeg ? (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : 0.5;

    return {
      n: X.length,
      accuracy: (tp + tn) / X.length,
      precision: tp + fp ? tp / (tp + fp) : 0,
      recall: nPos ? tp / nPos : 0,
      rocAuc: auc,
      positiveRate: nPos / X.length,
    };
  }
}
