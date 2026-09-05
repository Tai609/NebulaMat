import importlib.util
import unittest
from unittest import mock
from pathlib import Path


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts/generate_mindmap.py"
)
SPEC = importlib.util.spec_from_file_location("generate_mindmap", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class GenerateMindmapTests(unittest.TestCase):
    def test_build_html_escapes_title(self) -> None:
        html = MODULE.build_html("- Root", '</title><script>alert(1)</script>', "editorial")

        self.assertIn(
            "&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
            html,
        )
        self.assertNotIn("</title><script>alert(1)</script>", html)

    def test_strip_yaml_frontmatter(self) -> None:
        markdown = "---\ntitle: Demo\nlang: zh-CN\n---\n- Root\n  - Child\n"

        self.assertEqual(
            MODULE.strip_yaml_frontmatter(markdown),
            "- Root\n  - Child\n",
        )

    def test_strip_yaml_frontmatter_preserves_non_frontmatter(self) -> None:
        markdown = "---\nnot frontmatter really\n---\n- Root\n  - Child\n"

        self.assertEqual(MODULE.strip_yaml_frontmatter(markdown), markdown)

    def test_build_html_uses_theme_class_and_loader_fallback(self) -> None:
        html = MODULE.build_html("- Root", "Demo", "midnight")

        self.assertIn('body class="theme-midnight"', html)
        self.assertIn("body.theme-midnight", html)
        self.assertIn(MODULE.MARKMAP_SCRIPT_URLS[0], html)
        self.assertIn(MODULE.MARKMAP_SCRIPT_URLS[1], html)
        self.assertNotIn("fonts.googleapis.com", html)

    def test_build_html_enables_orthogonal_theme_flag(self) -> None:
        html = MODULE.build_html("- Root", "Demo", "orthogonal")

        self.assertIn('body class="theme-orthogonal"', html)
        self.assertIn("const ORTHOGONAL_LINKS = true;", html)

    def test_build_html_uses_air_theme_styles(self) -> None:
        html = MODULE.build_html("- Root", "Demo", "air")

        self.assertIn('body class="theme-air"', html)
        self.assertIn("body.theme-air", html)
        self.assertIn("linear-gradient(135deg, #f4f7ff 0%, #eef3ff 45%, #f8fbff 100%)", html)
        self.assertIn('const CUSTOM_LAYOUT = "topic-matrix";', html)
        self.assertIn("renderTopicMatrixLayout", html)
        self.assertIn('"distribution": "single-right"', html)
        self.assertIn("box-sizing: border-box;", html)
        self.assertIn(".topic-matrix-background", html)
        self.assertIn("if (node.siblingCount > 1)", html)
        self.assertIn("body.pdf-export .topic-matrix-item", html)

    def test_main_uses_air_as_default_theme(self) -> None:
        captured = {}

        async def fake_render_mindmap(
            md_path,
            output_dir,
            title,
            theme,
            scale,
            layout_distribution,
            pdf_mode,
            compressed_image_format,
            compressed_image_quality,
        ):
            captured["md_path"] = md_path
            captured["output_dir"] = output_dir
            captured["title"] = title
            captured["theme"] = theme
            captured["scale"] = scale
            captured["layout_distribution"] = layout_distribution
            captured["pdf_mode"] = pdf_mode
            captured["compressed_image_format"] = compressed_image_format
            captured["compressed_image_quality"] = compressed_image_quality

        with mock.patch.object(MODULE, "render_mindmap", fake_render_mindmap):
            with mock.patch("sys.argv", ["generate_mindmap.py", "--md", "demo.md"]):
                MODULE.main()

        self.assertEqual(captured["theme"], "air")
        self.assertEqual(captured["scale"], 1)
        self.assertEqual(captured["layout_distribution"], "single-right")
        self.assertEqual(captured["pdf_mode"], "raster")
        self.assertIsNone(captured["compressed_image_format"])
        self.assertEqual(captured["compressed_image_quality"], 82)

    def test_air_theme_uses_custom_layout_export_mode(self) -> None:
        self.assertTrue(MODULE.theme_uses_custom_layout_export(MODULE.THEMES["air"]))
        self.assertFalse(MODULE.theme_uses_custom_layout_export(MODULE.THEMES["editorial"]))

    def test_resolve_layout_config_supports_balanced_override(self) -> None:
        config = MODULE.resolve_layout_config(MODULE.THEMES["air"], "balanced")

        self.assertEqual(config["distribution"], "balanced")
        self.assertEqual(config["root_left"], 56)
        self.assertEqual(config["groups_left"], 370)
        self.assertEqual(config["side_padding"], 56)

    def test_custom_layout_export_uses_natural_viewport_and_device_scale(self) -> None:
        bbox = {"width": 4134, "height": 3345}

        config = MODULE.resolve_custom_layout_export_config(bbox, scale=2)

        self.assertLess(config["viewport_width"], 4134)
        self.assertLess(config["viewport_height"], 3345)
        self.assertEqual(config["device_scale_factor"], 2)
        self.assertGreater(len(config["tiles"]), 1)
        self.assertEqual(config["tiles"][0], {"x": 0, "y": 0, "width": 1536, "height": 1536})
        self.assertEqual(config["tiles"][-1], {"x": 3072, "y": 3072, "width": 1062, "height": 273})

    def test_resolve_vector_pdf_export_config_uses_single_page_with_backgrounds(self) -> None:
        config = MODULE.resolve_vector_pdf_export_config({"width": 4074, "height": 3297})

        self.assertEqual(config["width"], "4074px")
        self.assertEqual(config["height"], "3297px")
        self.assertTrue(config["print_background"])
        self.assertEqual(config["margin"], {"top": "0", "right": "0", "bottom": "0", "left": "0"})

    def test_resolve_compressed_image_export_config_uses_webp(self) -> None:
        config = MODULE.resolve_compressed_image_export_config("webp", 82)

        self.assertEqual(config["suffix"], ".webp")
        self.assertEqual(config["pil_format"], "WEBP")
        self.assertEqual(config["quality"], 82)
        self.assertEqual(config["method"], 6)

    def test_promote_single_root_list_item(self) -> None:
        markdown = "- Root\n  - Child A\n  - Child B\n"

        self.assertEqual(
            MODULE.promote_single_root_list_item(markdown),
            "# Root\n\n- Child A\n- Child B\n",
        )

    def test_promote_single_root_list_item_keeps_multi_root_list(self) -> None:
        markdown = "- Root A\n- Root B\n"

        self.assertEqual(MODULE.promote_single_root_list_item(markdown), markdown)

    def test_positive_int_rejects_zero(self) -> None:
        with self.assertRaises(Exception):
            MODULE.positive_int("0")


if __name__ == "__main__":
    unittest.main()
