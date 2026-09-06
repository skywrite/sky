/**
 * Chips typed one at a time with a suggestion list: the first suggestion is selected as soon as
 * results arrive, so Enter takes it — the way an editor's completion works. With no suggestion,
 * Enter adds what was typed; a separator adds it and keeps the caret; Backspace on an empty
 * field removes the last chip; Escape closes the list, then leaves the field.
 */

import { Combobox, Pill, PillsInput, useCombobox } from '@mantine/core'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'

export interface ChipOption {
  value: string
  label?: string
  type?: string
  hint?: string
  count?: number
  /** The document this option is, for options that are one */
  path?: string
}

export interface ChipsInputProps {
  chips: string[]
  options: ChipOption[]
  search: string
  onSearch: (search: string) => void
  onChange: (chips: string[]) => void
  /** What a chip shows before its text — a type mark */
  chipPrefix?: (chip: string) => ReactNode
  renderOption: (option: ChipOption) => ReactNode
  splitChars?: string[]
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

export function ChipsInput({
  chips,
  options,
  search,
  onSearch,
  onChange,
  chipPrefix,
  renderOption,
  splitChars = [','],
  placeholder,
  autoFocus,
  className,
}: ChipsInputProps) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() })
  const inputRef = useRef<HTMLInputElement>(null)
  // Each option once, keyed by what it is. Two rows with one key would make React keep a row
  // of an earlier answer when the list changes — rows would pile up as the search went on.
  const rows = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ key: string; option: ChipOption }> = []
    for (const option of options) {
      const key = `${option.path ?? ''}\n${option.value}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, option })
    }
    return out
  }, [options])
  const optionsKey = rows.map((row) => row.key).join('\n')
  useEffect(() => {
    if (search.length > 0 && rows.length > 0) {
      combobox.openDropdown()
    } else {
      combobox.closeDropdown()
    }
    // The store's functions are stable; the list and the search decide.
  }, [optionsKey, search.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Select after the portal is visible so reopening also scrolls back to the first result.
    if (combobox.dropdownOpened) combobox.selectFirstOption()
  }, [combobox.dropdownOpened, optionsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = (raw: string) => {
    const value = raw.trim()
    onSearch('')
    if (value.length === 0 || chips.includes(value)) return
    onChange([...chips, value])
  }

  return (
    <Combobox
      store={combobox}
      withinPortal
      shadow="md"
      width={440}
      position="bottom-start"
      middlewares={{
        shift: { padding: 12 },
        size: {
          padding: 12,
          apply: ({ availableHeight, elements }) => {
            elements.floating.style.setProperty('--sky-props-available-height', `${Math.max(0, availableHeight)}px`)
          },
        },
      }}
      onOptionSubmit={(value) => {
        add(value)
        combobox.closeDropdown()
      }}
    >
      <Combobox.DropdownTarget>
        <PillsInput className={className} variant="unstyled" size="sm" onClick={() => inputRef.current?.focus()}>
          <Pill.Group>
            {chips.map((chip) => (
              <Pill key={chip} withRemoveButton onRemove={() => onChange(chips.filter((c) => c !== chip))}>
                {chipPrefix?.(chip)}
                {chip}
              </Pill>
            ))}
            <Combobox.EventsTarget>
              <PillsInput.Field
                ref={inputRef}
                value={search}
                autoFocus={autoFocus}
                placeholder={chips.length === 0 ? placeholder : undefined}
                onChange={(event) => {
                  const next = event.currentTarget.value
                  const split = splitChars.find((ch) => next.endsWith(ch))
                  if (split) add(next.slice(0, -split.length))
                  else onSearch(next)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    if (combobox.dropdownOpened && combobox.getSelectedOptionIndex() >= 0) return
                    event.preventDefault()
                    add(search)
                  } else if (event.key === 'Backspace' && search.length === 0 && chips.length > 0) {
                    event.preventDefault()
                    onChange(chips.slice(0, -1))
                  } else if (event.key === 'Escape' && !combobox.dropdownOpened) {
                    event.currentTarget.blur()
                  }
                }}
                onBlur={() => {
                  if (search.trim().length > 0) add(search)
                  combobox.closeDropdown()
                }}
              />
            </Combobox.EventsTarget>
          </Pill.Group>
        </PillsInput>
      </Combobox.DropdownTarget>
      <Combobox.Dropdown className="sky-props-dropdown">
        <Combobox.Options>
          {rows.map(({ key, option }) => (
            <Combobox.Option
              value={option.value}
              key={key}
              title={[option.label ?? option.value, option.hint].filter(Boolean).join('\n')}
            >
              {renderOption(option)}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
