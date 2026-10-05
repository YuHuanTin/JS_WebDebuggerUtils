export class LogStore {
  constructor(maxEntries) {
    this.maxEntries = maxEntries;
    this.entries = new Array(maxEntries);
    this.sequences = new Array(maxEntries);
    this.start = 0;
    this.count = 0;
    this.nextSequence = 0;
  }

  get length() {
    return this.count;
  }

  append(entry, sequence = this.nextSequence) {
    const index = (this.start + this.count) % this.maxEntries;
    this.entries[index] = entry;
    this.sequences[index] = sequence;
    if (sequence >= this.nextSequence) this.nextSequence = sequence + 1;
    if (this.count === this.maxEntries) this.start = (this.start + 1) % this.maxEntries;
    else this.count += 1;
    return sequence;
  }

  clear() {
    this.entries.fill(undefined);
    this.sequences.fill(undefined);
    this.start = 0;
    this.count = 0;
    this.nextSequence = 0;
  }

  forEach(listener) {
    this.forEachRecord((entry, _sequence, index) => listener(entry, index));
  }

  forEachRecord(listener) {
    for (let index = 0; index < this.count; index++) {
      const slot = (this.start + index) % this.maxEntries;
      listener(this.entries[slot], this.sequences[slot], index);
    }
  }

  toRecords() {
    const records = new Array(this.count);
    this.forEachRecord((entry, sequence, index) => {
      records[index] = { entry, sequence };
    });
    return records;
  }
}

