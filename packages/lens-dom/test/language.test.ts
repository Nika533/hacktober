import { describe, expect, it } from 'vitest'
import { guessLanguage } from '../src/language'

describe('guessLanguage', () => {
  it('recognises the common Latin-script languages from their function words', () => {
    expect(
      guessLanguage(
        'When the spread of the residuals grows with the fitted values, the model shows heteroscedasticity and the standard errors are wrong.'
      )
    ).toBe('en')
    expect(
      guessLanguage(
        'Die Behörde verlangt künftig, dass Unternehmen die Streuung ihrer Messfehler offenlegen, auch wenn die Koeffizienten selbst unverzerrt bleiben und das nicht leicht ist.'
      )
    ).toBe('de')
    expect(
      guessLanguage(
        'Il faut toujours regarder les résidus avant de conclure, et la variance des erreurs est souvent sous-estimée dans les modèles qui sont trop simples.'
      )
    ).toBe('fr')
    expect(
      guessLanguage(
        'En Madrid, los analistas recomiendan errores estándar robustos para los datos de ventas, pero el modelo es más simple como se ve en las tablas.'
      )
    ).toBe('es')
  })

  it('recognises single-language scripts', () => {
    expect(
      guessLanguage('Οι αναλυτές πρέπει να ελέγχουν τη διακύμανση των σφαλμάτων πριν δημοσιεύσουν.')
    ).toBe('el')
    expect(
      guessLanguage('ანალიტიკოსებმა უნდა შეამოწმონ შეცდომების ვარიაცია შედეგების გამოქვეყნებამდე.')
    ).toBe('ka')
  })

  it('stays unsure when the evidence is thin or mixed', () => {
    expect(guessLanguage('Heteroscedasticity')).toBe('')
    expect(
      guessLanguage(
        'Table 3. OLS estimates, robust SE in parentheses (n = 1,204; R² = 0.31; p < 0.05).'
      )
    ).toBe('')
    // Cyrillic and Arabic script are shared by several languages.
    expect(
      guessLanguage(
        'Аналитики должны проверить дисперсию ошибок перед публикацией результатов исследования.'
      )
    ).toBe('')
    expect(
      guessLanguage(
        'يجب على المحللين التحقق من تباين الأخطاء قبل نشر النتائج في التقرير السنوي للشركة.'
      )
    ).toBe('')
  })
})
