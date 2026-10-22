import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

/**
 * フェーズ0 の確認用テスト。
 *
 * 検証したいのはアプリの機能ではなく、テスト環境そのものが成立していること:
 *   - Vite が TSX を変換し、CSS の import を解決できる
 *   - jsdom が DOM を提供している
 *   - React Testing Library が描画できる
 *   - vitest.setup.ts で登録した jest-dom の matcher(toBeInTheDocument)が使える
 */
describe('App', () => {
  it('見出しを描画する', () => {
    render(<App />)

    // getByRole で「役割」から要素を探す。class 名や DOM 構造ではなく、
    // 利用者から見た意味で検索するため、実装の変更に強いテストになる。
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
