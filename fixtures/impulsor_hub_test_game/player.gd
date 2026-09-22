extends Node2D

const SPEED := 200.0

func _process(delta: float) -> void:
	var dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	position += dir * SPEED * delta
	queue_redraw()

func _draw() -> void:
	draw_circle(Vector2.ZERO, 24.0, Color(0.35, 0.55, 1.0))
