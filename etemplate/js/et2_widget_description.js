/**
 * eGroupWare eTemplate2 - JS Description object
 *
 * @license http://opensource.org/licenses/gpl-license.php GPL - GNU General Public License
 * @package etemplate
 * @subpackage api
 * @link http://www.egroupware.org
 * @author Andreas Stöckel
 * @copyright Stylite 2011
 * @version $Id$
 */

"use strict";

/*egw:uses
	jquery.jquery;
	et2_core_baseWidget;
*/

/**
 * Class which implements the "description" XET-Tag
 */ 
var et2_description = et2_baseWidget.extend([et2_IDetachedDOM], {

	attributes: {
		"value": {
			"name": "Caption",
			"type": "string",
			"description": "Displayed text",
			"translate": "!no_lang"
		},

		/**
		 * Options converted from the "options"-attribute.
		 */
		"font_style": {
			"name": "Font Style",
			"type": "string",
			"description": "Style may be a compositum of \"b\" and \"i\" which " +
				" renders the text bold and/or italic."
		},
		"href": {
			"name": "Link Target",
			"type": "string",
			"description": "Link URL, empty if you don't wan't to display a link."
		},
		"activate_links": {
			"name": "Replace URLs",
			"type": "boolean",
			"default": false,
			"description": "If set, URLs in the text are automatically replaced " + 
				"by links"
		},
		"for": {
			"name": "Label for widget",
			"type": "string",
			"description": "Marks the text as label for the given widget."
		},
		"extra_link_target": {
			"name": "Link target",
			"type": "string",
			"default": "_self",
			"description": "Link target descriptor"
		},
		"extra_link_popup": {
			"name": "Popup",
			"type": "string",
			"description": "widthxheight, if popup should be used, eg. 640x480"
		},
		"extra_link_title": {
			"name": "Link Title",
			"type": "string",
			"description": "Link title which is displayed on mouse over.",
			"translate": true
		}
	},

	legacyOptions: ["font_style", "href", "activate_links", "for", 
		"extra_link_target", "extra_link_popup", "extra_link_title"],

	init: function() {
		this._super.apply(this, arguments);

		// Create the span/label tag which contains the label text
		this.span = $j(document.createElement(this.options["for"] ? "label" : "span"))
			.addClass("et2_label");

		if (this.options["for"])
		{
			// TODO: Get the real id of the widget in the doLoadingFinished method.
			this.span.attr("for", this.options["for"]);
		}

		et2_insertLinkText(this._parseText(this.options.value), this.span[0],
			this.options.extra_link_target);

		this.setDOMNode(this.span[0]);
	},

	transformAttributes: function(_attrs) {
		this._super.apply(arguments);

		if (this.id)
		{
			var val = this.getArrayMgr("content").getEntry(this.id);

			if (val)
			{
				_attrs["value"] = val;
			}
		}
	},

	_parseText: function(_value) {
		if (this.options.href)
		{
			return [{
				"href": this.options.href,
				"text": _value
			}];
		}
		else if (this.options.activate_links)
		{
			return et2_activateLinks(_value);
		}
		else
		{
			return [_value];
		}
	},

	set_font_style: function(_value) {
		this.font_style = _value;

		this.span.toggleClass("et2_bold", _value.indexOf("b") >= 0);
		this.span.toggleClass("et2_italic", _value.indexOf("i") >= 0);
	},

	/**
	 * Code for implementing et2_IDetachedDOM
	 */

	getDetachedAttributes: function(_attrs)
	{
		_attrs.push("value", "class");
	},

	getDetachedNodes: function()
	{
		return [this.span[0]];
	},

	setDetachedAttributes: function(_nodes, _values)
	{
		if (typeof _values["value"] != "undefined")
		{
			et2_insertLinkText(this._parseText(_values["value"]), _nodes[0],
				this.options.extra_link_target);
		}

		if (typeof _values["class"] != "undefined")
		{
			this.set_class(_values["class"]);
		}
	}
});

et2_register_widget(et2_description, ["description", "label"]);


