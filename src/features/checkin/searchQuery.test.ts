import { describe, expect, it } from 'vitest'
import { normalizeSearchQuery } from './searchQuery'

describe('normalizeSearchQuery', () => {
  it('pads short member numbers to 5 digits', () => {
    expect(normalizeSearchQuery('1')).toBe('00001')
    expect(normalizeSearchQuery('123')).toBe('00123')
    expect(normalizeSearchQuery('0123')).toBe('00123')
  })

  it('leaves full-length numbers and names unchanged', () => {
    expect(normalizeSearchQuery('12345')).toBe('12345')
    expect(normalizeSearchQuery('900001')).toBe('900001')
    expect(normalizeSearchQuery('สมชาย')).toBe('สมชาย')
    expect(normalizeSearchQuery('12 ก')).toBe('12 ก')
  })
})
