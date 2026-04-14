import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── Recipes ──────────────────────────────────────────────────────────────────

export async function fetchRecipes() {
  const { data, error } = await supabase
    .from('recipes')
    .select(`*, ingredients(*)`)
    .order('name')
  if (error) throw error
  return data.map(r => ({
    id: r.id,
    name: r.name,
    category: r.category,
    attention: r.attention,
    speed: r.speed,
    time: r.time_minutes,
    servings: r.servings,
    instructions: r.instructions,
    rating: r.rating,
    ingredients: r.ingredients.map(i => ({
      name: i.name,
      qty: i.qty,
      unit: i.unit,
    })),
  }))
}

export async function saveRecipe(recipe) {
  // Upsert recipe row
  const { data, error } = await supabase
    .from('recipes')
    .upsert({
      id: recipe.id || undefined,
      name: recipe.name,
      category: recipe.category,
      attention: recipe.attention,
      speed: recipe.speed,
      time_minutes: recipe.time,
      servings: recipe.servings,
      instructions: recipe.instructions,
      rating: recipe.rating || 0,
    })
    .select()
    .single()
  if (error) throw error

  // Replace ingredients
  await supabase.from('ingredients').delete().eq('recipe_id', data.id)
  if (recipe.ingredients?.length) {
    await supabase.from('ingredients').insert(
      recipe.ingredients.map(i => ({
        recipe_id: data.id,
        name: i.name,
        qty: i.qty,
        unit: i.unit,
      }))
    )
  }
  return data.id
}

export async function deleteRecipe(id) {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}

export async function updateRating(id, rating) {
  const { error } = await supabase
    .from('recipes')
    .update({ rating })
    .eq('id', id)
  if (error) throw error
}

// ─── Menu History ─────────────────────────────────────────────────────────────

export async function fetchHistory() {
  const { data, error } = await supabase
    .from('menu_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data.map(m => ({
    id: m.id,
    date: m.created_at,
    ids: m.recipe_ids,
    reason: m.reason,
  }))
}

export async function saveMenu(ids, reason) {
  const { error } = await supabase
    .from('menu_history')
    .insert({ recipe_ids: ids, reason })
  if (error) throw error
}

// ─── Config ───────────────────────────────────────────────────────────────────

export async function fetchConfig(key) {
  const { data, error } = await supabase
    .from('config')
    .select('value')
    .eq('key', key)
    .single()
  if (error) return null
  return data.value
}

export async function saveConfig(key, value) {
  const { error } = await supabase
    .from('config')
    .upsert({ key, value })
  if (error) throw error
}
