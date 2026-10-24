import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { ErrorBox } from './ui';

const notEnough = new ApiError(
  400,
  'invalid',
  "Only 3 pcs here, can't take 5",
  undefined,
  'stock.notEnough',
  {
    amount: '3 pcs',
    quantity: 5,
  },
);

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('error messages from the server', () => {
  it('shows them in the language of the app', async () => {
    await i18n.changeLanguage('fi');
    render(<ErrorBox error={notEnough} />);
    expect(screen.getByRole('alert').textContent).toContain('Täällä on vain 3 pcs, ei voi ottaa 5');
  });

  it("falls back to the server's own words for a key it doesn't know", async () => {
    await i18n.changeLanguage('fi');
    const newer = new ApiError(
      400,
      'invalid',
      'Something new',
      undefined,
      'stock.fromTheFuture' as never,
    );
    render(<ErrorBox error={newer} />);
    expect(screen.getByRole('alert').textContent).toContain('Something new');
  });
});
