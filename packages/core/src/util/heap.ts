/**
 * Generic MinHeap implementation with custom comparator.
 * 
 * Used by streaming coalesce to maintain beat-order without re-sorting.
 * 
 * Time complexity:
 * - push: O(log n)
 * - pop: O(log n)
 * - peek: O(1)
 * - isEmpty: O(1)
 * - size: O(1)
 */
export class MinHeap<T> {
  private heap: T[] = []

  /**
   * Create a new MinHeap.
   * @param comparator Function that returns negative if a < b, zero if equal, positive if a > b
   */
  constructor(private readonly comparator: (a: T, b: T) => number) {}

  /**
   * Add an item to the heap.
   */
  push(item: T): void {
    this.heap.push(item)
    this.siftUp(this.heap.length - 1)
  }

  /**
   * Remove and return the minimum item.
   * Returns undefined if heap is empty.
   */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined
    if (this.heap.length === 1) return this.heap.pop()

    const min = this.heap[0]
    this.heap[0] = this.heap.pop()!
    this.siftDown(0)
    return min
  }

  /**
   * Return the minimum item without removing it.
   * Returns undefined if heap is empty.
   */
  peek(): T | undefined {
    return this.heap[0]
  }

  /**
   * Check if heap is empty.
   */
  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /**
   * Return the number of items in the heap.
   */
  size(): number {
    return this.heap.length
  }

  /**
   * Restore heap property by moving item up.
   */
  private siftUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.comparator(this.heap[index], this.heap[parentIndex]) >= 0) {
        break
      }
      this.swap(index, parentIndex)
      index = parentIndex
    }
  }

  /**
   * Restore heap property by moving item down.
   */
  private siftDown(index: number): void {
    const length = this.heap.length

    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let smallest = index

      if (leftChild < length && this.comparator(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild
      }

      if (rightChild < length && this.comparator(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild
      }

      if (smallest === index) {
        break
      }

      this.swap(index, smallest)
      index = smallest
    }
  }

  /**
   * Swap two items in the heap.
   */
  private swap(i: number, j: number): void {
    const temp = this.heap[i]
    this.heap[i] = this.heap[j]
    this.heap[j] = temp
  }
}
