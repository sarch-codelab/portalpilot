-- Automation Rules table
CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  trigger_type TEXT NOT NULL,
  conditions JSONB DEFAULT '{}',
  actions JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  last_executed_at TIMESTAMPTZ,
  execution_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast tenant lookups
CREATE INDEX IF NOT EXISTS idx_automation_rules_empresa ON automation_rules(empresa_codigo);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);

-- RLS policies
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON automation_rules
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Anon read access" ON automation_rules
  FOR SELECT USING (true);

-- Seed some default rules for ROOT tenant
INSERT INTO automation_rules (empresa_codigo, nombre, descripcion, trigger_type, conditions, actions) VALUES
('ROOT', 'Alerta factura vencida', 'Notifica cuando una factura tiene más de 3 días vencida', 'factura_vencida', '{"dias_minimas": 3}', '[{"tipo":"notificar","titulo":"Factura vencida","mensaje":"Hay facturas vencidas que requieren atención"},{"tipo":"log","accion":"alerta_factura_vencida"}]'),
('ROOT', 'Stock bajo', 'Alerta cuando el stock de un producto baja del mínimo', 'stock_bajo', '{}', '[{"tipo":"notificar","titulo":"Stock bajo","mensaje":"Productos con stock por debajo del mínimo"},{"tipo":"log","accion":"alerta_stock_bajo"}]'),
('ROOT', 'Nuevo empleado', 'Acciones al registrar un nuevo usuario', 'usuario_creado', '{}', '[{"tipo":"notificar","titulo":"Nuevo usuario registrado","mensaje":"Se registró un nuevo usuario en el sistema"},{"tipo":"log","accion":"usuario_creado"}]')
ON CONFLICT DO NOTHING;
