import type { LocationSummary, UnitDetail } from '@ixfwms/domain';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render';
import { UnitPage } from './unit';

const place = (code: string, name: string, workstation = false): LocationSummary => ({
  id: code,
  code,
  name,
  type: workstation ? 'workstation' : 'shelf',
  kind: 'normal',
  shortName: null,
  short: '',
  movable: false,
  address: '',
  within: '',
  stayDays: null,
  dueAt: null,
  overdue: false,
  workstation,
  build: false,
  inBuild: null,
  dismantledAt: null,
  archivedAt: null,
  outOfLab: false,
});

const shelf = place('S3S3', 'Shelf 3');
const bench = place('W2W2', 'Workbench 2', true);

const unit = (over: Partial<UnitDetail>): UnitDetail => ({
  id: 'u',
  code: 'D2D2',
  name: 'Drill 2',
  ownName: 'Drill 2',
  serialNo: 'SN-778',
  status: 'ok',
  location: bench,
  home: shelf,
  atHome: false,
  loan: null,
  lastSeenAt: '2026-10-24T08:00:00.000Z',
  part: { id: 'p', code: 'P1P1', name: 'Impact drill', kind: 'tool', category: null },
  path: [bench],
  homePath: [shelf],
  ipAddress: null,
  hostname: null,
  macAddress: null,
  networkHidden: true,
  purchase: null,
  notes: null,
  nextCheckAt: null,
  checkDue: false,
  firmware: { version: 'V4.6', at: '2026-10-01T08:00:00.000Z' },
  createdAt: '2026-10-01T08:00:00.000Z',
  events: [
    {
      id: 'e',
      kind: 'moved',
      text: null,
      value: null,
      from: shelf,
      to: bench,
      by: 'Pekka',
      guest: true,
      at: '2026-10-24T08:00:00.000Z',
    },
  ],
  loans: [],
  reports: [],
  ...over,
});

describe('unit page', () => {
  it('shows where a unit is and where it belongs, and lets anyone put it back', async () => {
    const { fetchMock } = renderAt('/u/D2D2', [{ path: '/u/:code', element: <UnitPage /> }], {
      '/api/units/D2D2': unit({}),
      '/api/settings': { carryForgottenHours: 4, labelTape: '12', anonymousActions: 'put_back' },
    });
    expect(await screen.findByRole('heading', { name: 'Drill 2' })).toBeTruthy();
    expect(screen.getAllByText('Workbench 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Shelf 3').length).toBeGreaterThan(0);
    expect(screen.getByText('V4.6')).toBeTruthy();
    expect(screen.getByText('Log in to see network details')).toBeTruthy();
    expect(screen.getByText(/Pekka \(no account\)/)).toBeTruthy();
    // put_back allows putting back, not bringing to a workstation, and never lending.
    const putBack = await screen.findByRole('button', { name: 'Put back' });
    expect(screen.queryByRole('button', { name: 'Take to a workstation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lend out of the lab' })).toBeNull();
    await userEvent.click(putBack);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/units/D2D2/put-back' && init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('shows a loan with the person responsible', async () => {
    renderAt('/u/D2D2', [{ path: '/u/:code', element: <UnitPage /> }], {
      '/api/units/D2D2': unit({
        loan: {
          id: 'l',
          unit: { code: 'D2D2', name: 'Drill 2' },
          place: null,
          responsible: 'teacher',
          description: 'Thesis tests at Company X',
          outAt: '2026-10-01T08:00:00.000Z',
          dueAt: '2020-01-31',
          overdue: true,
          returnedAt: null,
          returnedBy: null,
        },
      }),
      '/api/settings': { carryForgottenHours: 4, labelTape: '12', anonymousActions: 'workstation' },
    });
    expect(await screen.findByText('Thesis tests at Company X')).toBeTruthy();
    expect(screen.getByText(/teacher is responsible/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Put back' })).toBeNull();
  });

  it('links to the case a unit went out in, which is returned as a whole', async () => {
    renderAt('/u/D2D2', [{ path: '/u/:code', element: <UnitPage /> }], {
      '/api/units/D2D2': unit({
        loan: {
          id: 'l',
          unit: null,
          place: { code: 'CASE', name: 'Drone case' },
          responsible: 'teacher',
          description: 'Field tests',
          outAt: '2026-10-01T08:00:00.000Z',
          dueAt: null,
          overdue: false,
          returnedAt: null,
          returnedBy: null,
        },
      }),
      '/api/settings': { carryForgottenHours: 4, labelTape: '12', anonymousActions: 'workstation' },
    });
    const link = await screen.findByRole('link', { name: 'Drone case' });
    expect(link.getAttribute('href')).toBe('/l/CASE');
    expect(screen.queryByRole('button', { name: 'Back from loan' })).toBeNull();
  });
});
