// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { datasetNameFromFileName, isZipFileName } from './dataset'

describe('isZipFileName', () => {
  it('拡張子が .zip(大文字も含む)なら true', () => {
    expect(isZipFileName('voc2012.zip')).toBe(true)
    expect(isZipFileName('VOC2012.ZIP')).toBe(true)
  })

  it('zip 以外は false', () => {
    expect(isZipFileName('voc2012.tar.gz')).toBe(false)
    expect(isZipFileName('zip')).toBe(false)
  })
})

describe('datasetNameFromFileName', () => {
  it('.zip を外した名前にする', () => {
    expect(datasetNameFromFileName('voc2012.zip')).toBe('voc2012')
    expect(datasetNameFromFileName('VOC.ZIP')).toBe('VOC')
  })

  it('zip でなければそのまま', () => {
    expect(datasetNameFromFileName('voc2012')).toBe('voc2012')
  })
})
