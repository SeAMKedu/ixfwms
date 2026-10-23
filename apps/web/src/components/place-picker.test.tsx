import type { PlaceOption } from '@ixfwms/domain';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render';
import { PlacePicker } from './place-picker';

const place = (code: string, path: string[], pathCodes: string[]): PlaceOption => ({
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
  workstation: false,
  path,
  pathCodes,
});
const places = [
  place('7SHY', ['Robotics lab'], ['7SHY']),
  place('C4BA', ['Robotics lab', 'Cabinet A'], ['7SHY', 'C4BA']),
  place('C4BB', ['Robotics lab', 'Cabinet B'], ['7SHY', 'C4BB']),
  place('53A1', ['Robotics lab', 'Cabinet A', 'Shelf 3'], ['7SHY', 'C4BA', '53A1']),
  place('53B1', ['Robotics lab', 'Cabinet B', 'Shelf 3'], ['7SHY', 'C4BB', '53B1']),
];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <PlacePicker value={value} onChange={setValue} label="Place" />
      <output data-testid="value">{value || 'none'}</output>
    </>
  );
}

describe('PlacePicker', () => {
  it('steps into places with Tab and chooses with Enter, without leaving the field', async () => {
    renderAt('/', [{ path: '/', element: <Harness /> }], { '/api/locations': places });
    const input = screen.getByRole('combobox', { name: 'Place' });
    await userEvent.type(input, 'robo');
    expect((await screen.findAllByRole('option', { name: /Robotics lab/ })).length).toBeGreaterThan(
      0,
    );
    await userEvent.keyboard('{Tab}');
    expect(input).toHaveProperty('placeholder', 'Inside Robotics lab…');
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, 'cab b');
    await userEvent.keyboard('{Tab}');
    expect(input).toHaveProperty('placeholder', 'Inside Cabinet B…');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('C4BB');
  });

  it('chooses a child after stepping in, and steps back out with Backspace', async () => {
    renderAt('/', [{ path: '/', element: <Harness /> }], { '/api/locations': places });
    const input = screen.getByRole('combobox', { name: 'Place' });
    await userEvent.type(input, 'cabinet a');
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Backspace}');
    expect(input).toHaveProperty('placeholder', 'Inside Robotics lab…');
    await userEvent.keyboard('{Backspace}');
    expect(input).toHaveProperty('placeholder', 'Type a place name or code…');
    await userEvent.type(input, 'cab a{Tab}shelf{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('53A1');
  });
});
