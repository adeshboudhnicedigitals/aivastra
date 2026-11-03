import { describe, expect, it } from 'vitest';
import { interpretOutput, RESTART_SCRIPT, scriptFor } from '../src/modules/fleet/command-exec';

const out = (...l: string[]) => `${l.join('\n')}\n`;

describe('interpretOutput: clear_queue', () => {
  it('succeeds when ComfyUI accepted the clear and nothing is pending after', () => {
    const r = interpretOutput('clear_queue', out('before 1 3', 'http 200', 'after 1 0'), 'u');
    expect(r).toEqual({
      state: 'SUCCEEDED',
      result: 'Cleared 3 pending prompt(s). Queue now 1 running, 0 pending.',
    });
  });
  it('fails, saying so, when pending prompts remain, the clear was refused or ComfyUI is silent', () => {
    expect(
      interpretOutput('clear_queue', out('before 0 2', 'http 200', 'after 0 2'), 'u').state,
    ).toBe('FAILED');
    expect(
      interpretOutput('clear_queue', out('before 0 2', 'http 500', 'after 0 2'), 'u').result,
    ).toMatch(/HTTP 500/);
    expect(
      interpretOutput('clear_queue', out('before error', 'http 000', 'after error'), 'u').result,
    ).toMatch(/did not answer/);
  });
  it('fails without claiming anything when SSH itself failed', () => {
    expect(interpretOutput('clear_queue', null, 'u')).toMatchObject({
      state: 'FAILED',
      result: expect.stringMatching(/nothing was changed/),
    });
  });
});

describe('interpretOutput: restart_comfyui', () => {
  it('succeeds only when restart exited 0, ComfyUI answers and the unit is active', () => {
    const r = interpretOutput(
      'restart_comfyui',
      out('before 0 0', 'restart exit 0', 'after 0 0', 'active active'),
      'comfyui',
    );
    expect(r.state).toBe('SUCCEEDED');
    expect(r.result).toMatch(/Restarted comfyui/);
  });
  it('is not restarted, and says why, when work appeared after the request', () => {
    const r = interpretOutput('restart_comfyui', out('before 1 0', 'busy'), 'comfyui');
    expect(r).toMatchObject({
      state: 'FAILED',
      result: expect.stringMatching(/got work.*Not restarted/),
    });
  });
  it('reports the real reason when sudo needs a password', () => {
    const r = interpretOutput('restart_comfyui', out('before 0 0', 'sudo denied'), 'comfyui');
    expect(r.state).toBe('FAILED');
    expect(r.result).toMatch(/Needs root/);
  });
  it('fails for a nonzero exit, a service that is not active, or a ComfyUI that never came back', () => {
    expect(
      interpretOutput(
        'restart_comfyui',
        out('before 0 0', 'restart exit 1', 'after error', 'active failed'),
        'u',
      ).state,
    ).toBe('FAILED');
    expect(
      interpretOutput(
        'restart_comfyui',
        out('before 0 0', 'restart exit 0', 'after error', 'active active'),
        'u',
      ).result,
    ).toMatch(/did not come back/);
    expect(
      interpretOutput(
        'restart_comfyui',
        out('before 0 0', 'restart exit 0', 'after 0 0', 'active activating'),
        'u',
      ).state,
    ).toBe('FAILED');
  });
  it('never succeeds on missing output', () => {
    expect(interpretOutput('restart_comfyui', '', 'u').state).toBe('FAILED');
    expect(interpretOutput('restart_comfyui', null, 'u').state).toBe('FAILED');
  });
});

describe('scripts', () => {
  it('only ever use passwordless sudo and never prompt', () => {
    const commands = RESTART_SCRIPT.split('\n').filter(
      (l) => l.includes('sudo') && !l.trim().startsWith('echo'),
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const l of commands) expect(l).toContain('sudo -n');
  });
  it('picks the script for the kind', () => {
    expect(scriptFor('clear_queue')).not.toContain('systemctl');
    expect(scriptFor('restart_comfyui')).toContain('systemctl restart');
  });
});
