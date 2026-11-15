import { describe, expect, it } from 'vitest';
import {
  buildShareableUrl,
  deserializePermalink,
  serializePermalink,
  SerializedState,
} from '../src/model/permalink';

describe('URL State Serialization & Permalink Engine (R3)', () => {
  const sampleState: SerializedState = {
    sp: 'ponderosa-pine',
    lat: 35.2645,
    lon: -111.7442,
    age: 250,
    death: 2026,
    mode: 'peel',
    year: 1934,
    preset: 'pluvial-megadrought',
    pal: 'aged-wood',
  };

  it('serializes full state into valid query parameter string', () => {
    const serialized = serializePermalink(sampleState);
    expect(serialized).toContain('sp=ponderosa-pine');
    expect(serialized).toContain('lat=35.2645');
    expect(serialized).toContain('lon=-111.7442');
    expect(serialized).toContain('age=250');
    expect(serialized).toContain('death=2026');
    expect(serialized).toContain('mode=peel');
    expect(serialized).toContain('year=1934');
    expect(serialized).toContain('preset=pluvial-megadrought');
    expect(serialized).toContain('pal=aged-wood');
    expect(serialized.startsWith('?')).toBe(true);
  });

  it('omits undefined and empty fields when serializing partial state', () => {
    const partial: Partial<SerializedState> = {
      sp: 'douglas-fir',
      age: 150,
      mode: 'grow',
    };
    const serialized = serializePermalink(partial);
    expect(serialized).toBe('?sp=douglas-fir&age=150&mode=grow');
    expect(serialized).not.toContain('lat=');
    expect(serialized).not.toContain('death=');
    expect(serialized).not.toContain('preset=');
  });

  it('returns empty string when given empty state object', () => {
    expect(serializePermalink({})).toBe('');
  });

  it('deserializes query string with leading question mark', () => {
    const query = '?sp=ponderosa-pine&lat=44.2124&lon=-121.5542&age=300&death=2020&mode=grow&year=1845&preset=wildfire-scarring&pal=charred-subalpine';
    const parsed = deserializePermalink(query);

    expect(parsed.sp).toBe('ponderosa-pine');
    expect(parsed.lat).toBe(44.2124);
    expect(parsed.lon).toBe(-121.5542);
    expect(parsed.age).toBe(300);
    expect(parsed.death).toBe(2020);
    expect(parsed.mode).toBe('grow');
    expect(parsed.year).toBe(1845);
    expect(parsed.preset).toBe('wildfire-scarring');
    expect(parsed.pal).toBe('charred-subalpine');
  });

  it('deserializes hash-based URL string', () => {
    const hash = '#sp=bristlecone-pine&lat=37.382&lon=-118.172&age=500&mode=peel';
    const parsed = deserializePermalink(hash);

    expect(parsed.sp).toBe('bristlecone-pine');
    expect(parsed.lat).toBe(37.382);
    expect(parsed.lon).toBe(-118.172);
    expect(parsed.age).toBe(500);
    expect(parsed.mode).toBe('peel');
  });

  it('deserializes from full absolute URL string', () => {
    const fullUrl = 'https://xylem-archive.art/exhibition?sp=ponderosa-pine&lat=35.2645&lon=-111.7442&age=250&death=2026';
    const parsed = deserializePermalink(fullUrl);

    expect(parsed.sp).toBe('ponderosa-pine');
    expect(parsed.lat).toBe(35.2645);
    expect(parsed.lon).toBe(-111.7442);
    expect(parsed.age).toBe(250);
    expect(parsed.death).toBe(2026);
  });

  it('guarantees round-trip fidelity: deserialize(serialize(state)) matches original values', () => {
    const serialized = serializePermalink(sampleState);
    const roundTripped = deserializePermalink(serialized);

    expect(roundTripped).toEqual(sampleState);
  });

  it('safely handles and clamps boundary and out-of-range values', () => {
    // Latitude out of range
    const invalidLat = deserializePermalink('?lat=120.5&lon=-75.0');
    expect(invalidLat.lat).toBeUndefined();
    expect(invalidLat.lon).toBe(-75.0);

    // Longitude out of range
    const invalidLon = deserializePermalink('?lat=45.0&lon=250.0');
    expect(invalidLon.lat).toBe(45.0);
    expect(invalidLon.lon).toBeUndefined();

    // Age clamped between 5 and 500
    const tooYoung = deserializePermalink('?age=1');
    expect(tooYoung.age).toBe(5);

    const tooOld = deserializePermalink('?age=1200');
    expect(tooOld.age).toBe(500);

    // Death year clamped
    const earlyDeath = deserializePermalink('?death=800');
    expect(earlyDeath.death).toBe(1400);

    const futureDeath = deserializePermalink('?death=3000');
    expect(futureDeath.death).toBe(2100);

    // Invalid mode ignored
    const badMode = deserializePermalink('?mode=warp-speed');
    expect(badMode.mode).toBeUndefined();

    // Invalid palette ignored
    const badPal = deserializePermalink('?pal=neon-rainbow');
    expect(badPal.pal).toBeUndefined();
  });

  it('handles empty or malformed strings gracefully without throwing', () => {
    expect(deserializePermalink('')).toEqual({});
    expect(deserializePermalink('???&&&=')).toEqual({});
    expect(deserializePermalink('not-a-valid-query')).toEqual({});
  });

  it('buildShareableUrl constructs a clean shareable URL with base', () => {
    const url = buildShareableUrl(
      { sp: 'ponderosa-pine', age: 200, mode: 'peel' },
      'https://museum.org/xylem'
    );
    expect(url).toBe('https://museum.org/xylem?sp=ponderosa-pine&age=200&mode=peel');
  });

  describe('Tier 5 Adversarial Coverage & State Hardening', () => {
    it('rejects prototype property names in mode, sp, and pal without setting functions', () => {
      const modeVuln = deserializePermalink('?mode=valueOf&sp=toString&pal=constructor');
      expect(modeVuln.mode).toBeUndefined();
      expect(modeVuln.sp).toBeUndefined();
      expect(modeVuln.pal).toBeUndefined();
      expect(typeof modeVuln.mode).not.toBe('function');
      expect(typeof modeVuln.sp).not.toBe('function');
    });

    it('serializes state safely without emitting prototype property names', () => {
      const maliciousState: any = {
        mode: 'toString',
        pal: 'constructor',
        sp: 'valueOf',
      };
      const serialized = serializePermalink(maliciousState);
      expect(serialized).not.toContain('mode=toString');
      expect(serialized).not.toContain('pal=constructor');
      expect(serialized).not.toContain('sp=valueOf');
    });

    it('strips trailing URL fragments (#...) from search parameter strings', () => {
      const parsed1 = deserializePermalink('https://example.com/?sp=douglas-fir#gallery');
      expect(parsed1.sp).toBe('douglas-fir');

      const parsed2 = deserializePermalink('https://example.com/?mode=peel#section');
      expect(parsed2.mode).toBe('peel');
    });

    it('bounds active year parameter safely to non-negative calendar years', () => {
      expect(deserializePermalink('?year=-500').year).toBeUndefined();
      expect(deserializePermalink('?year=999999').year).toBeUndefined();
      expect(deserializePermalink('?year=1980').year).toBe(1980);
      expect(deserializePermalink('?year=0').year).toBe(0);
    });
  });
});
