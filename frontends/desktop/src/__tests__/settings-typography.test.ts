// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const settingsCss = fs.readFileSync(
  path.join(desktopRoot, 'src/components/settings/settings.css'),
  'utf8',
);
const sectionTitle = fs.readFileSync(
  path.join(desktopRoot, 'src/components/settings/SettingsSectionTitle.tsx'),
  'utf8',
);

describe('Settings typography hierarchy', () => {
  it('keeps section headings above normal body text', () => {
    expect(settingsCss).toMatch(/\.ga-set-sec-t\s*\{[^}]*font-size: 16px/s);
    expect(settingsCss).toMatch(/\.ga-set-sec-t\s*\{[^}]*line-height: 24px/s);
    expect(settingsCss).toMatch(/\.ga-data-row-label\s*\{[^}]*font-size: 14px/s);
    expect(settingsCss).toMatch(/\.ga-connection-description\s*\{[^}]*font-size: 14px/s);
    expect(settingsCss).toMatch(/\.ga-model-name\s*\{[^}]*font-size: 14px/s);
    expect(sectionTitle).toContain('<h2 className="ga-set-sec-t">{children}</h2>');
    expect(sectionTitle).toContain('className="ga-set-sec-heading"');
  });

  it('uses localized, product-level section names', () => {
    expect([zh['set.appearance'], zh['set.lang'], zh['set.model']])
      .toEqual(['外观', '语言', '模型配置']);
    expect([en['set.appearance'], en['set.lang'], en['set.model']])
      .toEqual(['Appearance', 'Language', 'Model configuration']);
  });
});
