import type { PlaceOption } from '@ixfwms/domain';
import { describe, expect, it } from 'vitest';
import { matchPlaces, placeLabel } from './places';

const place = (code: string, ...path: string[]): PlaceOption => ({
  id: code,
  code,
  name: path[path.length - 1]!,
  type: 'box',
  kind: 'normal',
  shortName: null,
  short: '',
  movable: false,
  address: '',
  within: '',
  stayDays: null,
  dueAt: null,
  overdue: false,
  path,
  pathCodes: [],
});
const places = [
  place('7SHY', 'Robotics lab'),
  place('C4BA', 'Robotics lab', 'Cabinet A'),
  place('C4BB', 'Robotics lab', 'Cabinet B'),
  place('53A1', 'Robotics lab', 'Cabinet A', 'Shelf 3'),
  place('53B1', 'Robotics lab', 'Cabinet B', 'Shelf 3'),
  place('K7Q2', 'Robotics lab', 'Cabinet A', 'Shelf 3', 'Box: vacuum parts'),
];
const labels = (q: string) => matchPlaces(places, q).map(placeLabel);

describe('matchPlaces', () => {
  it('finds fixed places by address', () => {
    const addressed = places.map((p) => ({
      ...p,
      address: ['RL', ...p.path.slice(1).map((n) => n.split(' ').pop()!)].join('-'),
    }));
    const found = matchPlaces(addressed, 'rl-a-3').map(placeLabel);
    expect(found[0]).toBe('Robotics lab › Cabinet A › Shelf 3');
    expect(matchPlaces(addressed, 'rl-b').map(placeLabel)[0]).toBe('Robotics lab › Cabinet B');
  });

  it('follows the hierarchy when levels are separated', () => {
    expect(labels('cab a › sh')[0]).toBe('Robotics lab › Cabinet A › Shelf 3');
    expect(labels('cab b / shelf')).toEqual(['Robotics lab › Cabinet B › Shelf 3']);
  });

  it('matches plain words anywhere in the path, own name first', () => {
    expect(labels('vacuum')).toEqual(['Robotics lab › Cabinet A › Shelf 3 › Box: vacuum parts']);
    expect(labels('cabinet a shelf')[0]).toBe('Robotics lab › Cabinet A › Shelf 3');
    expect(labels('cabinet')[0]).toMatch(/Cabinet [AB]$/);
  });

  it('puts an exact code first, typed any way', () => {
    expect(matchPlaces(places, 'k7q2')[0]?.code).toBe('K7Q2');
  });

  it('finds nothing for nonsense', () => {
    expect(labels('freezer')).toEqual([]);
  });
});
