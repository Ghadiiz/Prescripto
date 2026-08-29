import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';

import VerifyEmail from './VerifyEmail';

// CHARACTERISATION, ahead of 6.9.
//
// This is the one target whose effect has a real SIDE EFFECT rather than
// deriving state: it posts the token on mount. So the assertion that matters
// most is that it fires EXACTLY ONCE — the cascading-render problem the lint
// rule warns about would show up here as a duplicate verification request.
//
// Only axios and the toast are stubbed; routing is real, so the token genuinely
// comes from the query string the way it does in the browser.

vi.mock('axios');
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const renderAt = (search) =>
  render(
    <MemoryRouter initialEntries={[`/verify-email${search}`]}>
      <VerifyEmail />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VerifyEmail', () => {
  it('posts the token from the query string exactly once', async () => {
    axios.post.mockResolvedValue({ data: { success: true } });

    renderAt('?token=abc123');

    expect(await screen.findByText(/verified successfully/i)).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/auth/verify-email'), {
      token: 'abc123',
    });
  });

  it('shows the verifying state before the request settles', () => {
    axios.post.mockReturnValue(new Promise(() => {}));

    renderAt('?token=abc123');

    expect(screen.getByText(/verifying your email/i)).toBeInTheDocument();
  });

  it('reports a failed verification', async () => {
    axios.post.mockResolvedValue({
      data: { success: false, message: 'Token expired' },
    });

    renderAt('?token=stale');

    expect(await screen.findByText('Token expired')).toBeInTheDocument();
  });

  it('reports a rejected request', async () => {
    axios.post.mockRejectedValue({
      response: { data: { message: 'Link already used' } },
    });

    renderAt('?token=used');

    expect(await screen.findByText('Link already used')).toBeInTheDocument();
  });

  it('refuses a link with no token, without calling the API', async () => {
    renderAt('');

    expect(
      await screen.findByText(/no token provided/i),
    ).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });
});
