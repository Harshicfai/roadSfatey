INSERT INTO users (id, name)
VALUES ('demo-user', 'Demo User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO responders (name, responder_type, latitude, longitude, phone)
VALUES
  ('City Ambulance 12', 'ambulance', 12.9741, 77.5935, '+91-9000000012'),
  ('Highway Patrol Unit 5', 'police', 12.9680, 77.6015, '+91-9000000005'),
  ('Volunteer Asha', 'volunteer', 12.9655, 77.5888, '+91-9000001010'),
  ('Emergency Medical Van 3', 'ambulance', 12.9790, 77.6105, '+91-9000000013'),
  ('Traffic Police South', 'police', 12.9600, 77.5950, '+91-9000000006'),
  ('Volunteer Ravi', 'volunteer', 12.9724, 77.5800, '+91-9000001011')
ON CONFLICT DO NOTHING;
