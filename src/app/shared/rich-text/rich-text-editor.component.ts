import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  forwardRef,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Editor } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import { asEditorHtml } from '../../core/utils/html-text.utils';

@Component({
  selector: 'app-rich-text-editor',
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.css',
  encapsulation: ViewEncapsulation.None,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditorComponent),
      multi: true,
    },
  ],
})
export class RichTextEditorComponent implements ControlValueAccessor, AfterViewInit, OnDestroy {
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private editor: Editor | null = null;
  private pendingHtml = '';
  private lastEmitted: string | null = null;
  private suppressUpdate = true;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  readonly disabled = signal(false);
  /** La barra lee este contador para refrescar el botón activo. */
  private readonly uiTick = signal(0);

  ngAfterViewInit(): void {
    this.editor = new Editor({
      element: this.host().nativeElement,
      extensions: [
        StarterKit.configure({
          link: false,
          code: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
          heading: { levels: [3] },
        }),
        TextStyle,
        Color,
        TableKit.configure({
          table: { resizable: false },
        }),
        Placeholder.configure({
          placeholder: 'Escribe el requerimiento. Puedes usar negrita, cursiva, color y cuadros.',
        }),
      ],
      content: this.pendingHtml,
      editable: !this.disabled(),
      editorProps: {
        attributes: {
          class: 'rich-text-body',
          'aria-label': 'Descripción del requerimiento',
        },
      },
      onUpdate: ({ editor }) => {
        if (this.suppressUpdate) return;
        const next = editor.isEmpty ? '' : editor.getHTML();
        if (next === this.lastEmitted) return;
        this.lastEmitted = next;
        this.onChange(next);
      },
      onTransaction: () => {
        this.uiTick.update((n) => n + 1);
      },
      onBlur: () => {
        this.onTouched();
      },
    });
    queueMicrotask(() => {
      this.suppressUpdate = false;
    });
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = null;
  }

  writeValue(value: string | null): void {
    const incoming = value ?? '';
    if (incoming === this.lastEmitted) return;
    this.lastEmitted = incoming;
    const html = asEditorHtml(incoming);
    this.pendingHtml = html;
    this.editor?.commands.setContent(html, { emitUpdate: false });
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
    this.editor?.setEditable(!isDisabled);
  }

  markActive(name: string): boolean {
    this.uiTick();
    return this.editor?.isActive(name) ?? false;
  }

  currentColor(): string {
    this.uiTick();
    const color = this.editor?.getAttributes('textStyle')['color'];
    return typeof color === 'string' && color !== '' ? color : '#1f2937';
  }

  canEditTable(): boolean {
    this.uiTick();
    return this.editor?.can().deleteTable() ?? false;
  }

  keepSelection(event: Event): void {
    event.preventDefault();
  }

  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleUnderline(): void {
    this.editor?.chain().focus().toggleUnderline().run();
  }

  toggleHeading(): void {
    this.editor?.chain().focus().toggleHeading({ level: 3 }).run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  applyColor(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.editor?.chain().focus().setColor(value).run();
  }

  clearColor(): void {
    this.editor?.chain().focus().unsetColor().run();
  }

  insertTable(): void {
    this.editor
      ?.chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  }

  addRow(): void {
    this.editor?.chain().focus().addRowAfter().run();
  }

  addColumn(): void {
    this.editor?.chain().focus().addColumnAfter().run();
  }

  deleteTable(): void {
    this.editor?.chain().focus().deleteTable().run();
  }
}
