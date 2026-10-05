export class FenwickTree {
  constructor(capacity) {
    this.capacity = capacity;
    this.values = new Float64Array(capacity + 1);
    this.size = 0;
  }

  build(size, getValue) {
    this.values.fill(0);
    this.size = size;
    for (let index = 0; index < size; index++) {
      this.values[index + 1] = getValue(index);
    }
    for (let index = 1; index <= size; index++) {
      const parent = index + (index & -index);
      if (parent <= this.capacity) this.values[parent] += this.values[index];
    }
  }

  add(index, delta) {
    for (let node = index + 1; node <= this.capacity; node += node & -node) {
      this.values[node] += delta;
    }
  }

  sum(length = this.size) {
    let result = 0;
    for (let node = Math.min(length, this.size); node > 0; node -= node & -node) {
      result += this.values[node];
    }
    return result;
  }

  valueAt(index) {
    return this.sum(index + 1) - this.sum(index);
  }

  lowerBound(target) {
    if (target <= 0) return 0;
    let index = 0;
    let accumulated = 0;
    let bit = 1;
    while ((bit << 1) <= this.size) bit <<= 1;
    for (; bit > 0; bit >>= 1) {
      const next = index + bit;
      if (next <= this.size && accumulated + this.values[next] < target) {
        index = next;
        accumulated += this.values[next];
      }
    }
    return Math.min(index, this.size);
  }
}

