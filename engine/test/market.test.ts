import { describe, expect, it } from 'vitest';
import { BookSide } from '../src/perpl/ws.js';
import { walkBook } from '../src/perpl/market.js';
import { OPEN_LONG, OPEN_SHORT } from '../src/domain/types.js';

describe('Perpl L2 book', () => {
  it('applies snapshot then updates; o:0 removes a level', () => {
    const asks = new BookSide(false);
    asks.reset([{ p: 101, s: 5, o: 1 }, { p: 100, s: 2, o: 1 }]);
    expect(asks.best()).toBe(100);
    asks.apply([{ p: 100, s: 0, o: 0 }, { p: 102, s: 7, o: 2 }]);
    expect(asks.sorted()).toEqual([{ p: 101, s: 5 }, { p: 102, s: 7 }]);
    const bids = new BookSide(true);
    bids.reset([{ p: 98, s: 1, o: 1 }, { p: 99, s: 1, o: 1 }]);
    expect(bids.sorted().map((l) => l.p)).toEqual([99, 98]);
  });

  it('expected fill walks the book within the limit', () => {
    const asks = [{ p: 100, s: 2 }, { p: 101, s: 2 }, { p: 110, s: 10 }];
    expect(walkBook(asks, OPEN_LONG, 3n)).toEqual({ pricePNS: 100n, filledLots: 3n }); // (200+101)/3 = 100.33 -> 100
    expect(walkBook(asks, OPEN_LONG, 4n, 105n)).toEqual({ pricePNS: 100n, filledLots: 4n });
    expect(walkBook(asks, OPEN_LONG, 6n, 105n)).toEqual({ pricePNS: 100n, filledLots: 4n });
    expect(walkBook([{ p: 99, s: 1 }], OPEN_SHORT, 1n, 100n)).toEqual({ pricePNS: undefined, filledLots: 0n });
  });
});
