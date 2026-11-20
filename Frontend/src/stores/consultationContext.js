import { computed, readonly, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth'

const STORAGE_KEY = 'oral_rehab_consultation_patient_v1'

function patientNumber(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** The doctor's consultation selection; route and training objects own their IDs. */
export const useConsultationContextStore = defineStore('consultationContext', () => {
  const auth = useAuthStore()
  const selectedId = ref(null)
  const selectionSource = ref('restore')
  const patientId = computed(() => auth.userRole === 'patient'
    ? patientNumber(auth.patientId)
    : auth.userRole === 'doctor' ? selectedId.value : null)

  watch(() => auth.sessionKey, () => {
    selectionSource.value = 'restore'
    selectedId.value = null
    // The old bare ID has no provable account owner and cannot be restored.
    localStorage.removeItem('chat_selected_patient_id')
    if (auth.userRole !== 'doctor' || !auth.accountKey) return
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved?.accountKey === auth.accountKey) selectedId.value = patientNumber(saved.patientId)
    } catch (_) {
      // An invalid optional selection is not an authenticated business object.
    }
  }, { immediate: true, flush: 'sync' })

  function selectPatient(value, source = 'user') {
    if (auth.userRole !== 'doctor' || !auth.accountKey) return false
    selectionSource.value = source
    selectedId.value = patientNumber(value)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accountKey: auth.accountKey, patientId: selectedId.value }))
    return true
  }

  return { patientId, selectionSource: readonly(selectionSource), selectPatient }
})
