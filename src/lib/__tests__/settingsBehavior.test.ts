// @vitest-environment happy-dom
import {afterEach,describe,it,expect} from 'vitest';
import {nativeShortcut} from '../settingsSync';
import {getExtensions} from '../../editor/extensions';
import {SlashCommand} from '../../editor/SlashCommand';
import {Editor} from '@tiptap/core';
afterEach(()=>localStorage.clear());
describe('recorded shortcut and extension preferences',()=>{
 it('converts recorded native modifiers and preserves key identity',()=>{
  expect(nativeShortcut('⌘⇧Space')).toBe('Shift+CommandOrControl+Space');
  expect(nativeShortcut('⌃⌥N')).toBe('Control+Alt+N');
  expect(()=>nativeShortcut('A')).toThrow();
 });
 it('disables slash insertion without removing schema support',()=>{
  localStorage.setItem('notefast_commands_config',JSON.stringify([{id:'slash',enabled:false},{id:'tables',enabled:false}]));
  const e=new Editor({extensions:getExtensions(SlashCommand)});
  const extension=e.extensionManager.extensions.find(x=>x.name==='slashCommand')!;
  expect(extension.options.suggestion.allow()).toBe(false);
  expect(extension.options.suggestion.items({query:'table'})).toHaveLength(0);
  expect(e.schema.nodes.table).toBeDefined();
  e.destroy();
 });
});
