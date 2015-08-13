/* global msg */

/**
 * mail - static javaScript functions
 *
 * @link http://www.egroupware.org
 * @author Stylite AG [info@stylite.de]
 * @copyright (c) 2013-2014 by Stylite AG <info-AT-stylite.de>
 * @package mail
 * @license http://opensource.org/licenses/gpl-license.php GPL - GNU General Public License
 * @version $Id$
 */

/*egw:uses
	phpgwapi.jquery.jquery.base64;
*/

/**
 * UI for mail
 *
 * @augments AppJS
 */
app.classes.mail = AppJS.extend(
{
	appname: 'mail',

	/**
	 * et2 widget container
	 */
	et2: null,
	doStatus: null,

	mail_queuedFolders: [],
	mail_queuedFoldersIndex: 0,

	mail_selectedMails: [],
	mail_currentlyFocussed: '',
	mail_previewAreaActive: true, // we start with the area active

	nm_index: 'nm', // nm name of index
	mail_fileSelectorWindow: null,
	mail_isMainWindow: true,

	// Some state variables to track preview pre-loading
	preview_preload: {
		timeout: null,
		request: null
	},
	/**
	 * 
	 */
	subscription_treeLastState : "",
	
	/**
	 * abbrevations for common access rights
	 * @array
	 *
	 */
	aclCommonRights:['lrs','lprs','ilprs',	'ilprsw', 'aeiklprstwx', 'custom'],
	/**
	 * Demonstrates ACL rights
	 * @array
	 *
	 */
	aclRights:['l','r','s','w','i','p','c','d','a'],

	/**
	 * In order to store Intervals assigned to window
	 * @array of setted intervals
	 */
	W_INTERVALS:[],

	/**
	 * Initialize javascript for this application
	 *
	 * @memberOf mail
	 */
	init: function() {
		this._super.apply(this,arguments);
		if (!this.egw.is_popup())
			// Turn on client side, persistent cache
			// egw.data system runs encapsulated below etemplate, so this must be
			// done before the nextmatch is created.
			this.egw.dataCacheRegister('mail',
				// Called to determine cache key
				this.nm_cache,
				// Called whenever cache is used
				// TODO: Change this as needed
				function(server_query)
				{
					// Unlock tree if using a cache, since the server won't
					if(!server_query) this.unlock_tree();
				},
				this
			);
	},

	/**
	 * Destructor
	 */
	destroy: function()
	{
		// Unbind from nm refresh
		if(this.et2 != null)
		{
			var nm = this.et2.getWidgetById(this.nm_index);
			if(nm != null)
			{
				$j(nm).off('refresh');
			}
		}

		// Unregister client side cache
		this.egw.dataCacheUnregister('mail');

		delete this.et2_obj;
		// call parent
		this._super.apply(this, arguments);
	},

	/**
	 * check and try to reinitialize et2 of module
	 */
	checkET2: function()
	{
		//this.et2 should do the same as etemplate2.getByApplication('mail')[0].widgetContainer
		if (!this.et2) // if not defined try this in order to recover
		{
			try
			{
				this.et2 = etemplate2.getByApplication('mail')[0].widgetContainer;
			}
			catch(e)
			{
				return false;
			}
		}
		return true;
	},

	/**
	 * This function is called when the etemplate2 object is loaded
	 * and ready.  If you must store a reference to the et2 object,
	 * make sure to clean it up in destroy().
	 *
	 * @param et2 etemplate2 Newly ready object
	 * @param {string} _name template name
	 */
	et2_ready: function(et2, _name)
	{
		// call parent; somehow this function is called more often. (twice on a display and compose) why?
		this._super.apply(this, arguments);
		this.et2_obj = et2;

		switch (_name)
		{
			case 'mail.sieve.vacation':
				this.vacationFilterStatusChange();
				break;
			case 'mail.mobile_index':
			case 'mail.index':
				var self = this;
				jQuery('iframe#mail-index_messageIFRAME').on('load', function()
				{
					// decrypt preview body if mailvelope is available
					self.mailvelopeAvailable(self.mailvelopeDisplay);
					self.mail_prepare_print();
				});
				var nm = this.et2.getWidgetById(this.nm_index);
				this.mail_isMainWindow = true;
				this.mail_disablePreviewArea(true);

				// Bind to nextmatch refresh to update folder status
				if(nm != null && (typeof jQuery._data(nm).events=='undefined'||typeof jQuery._data(nm).events.refresh == 'undefined'))
				{
					var self = this;
					$j(nm).on('refresh',function() {self.mail_refreshFolderStatus.call(self,undefined,undefined,false);});
				}
				var tree_wdg = this.et2.getWidgetById(this.nm_index+'[foldertree]');
				if (tree_wdg)
				{
					tree_wdg.set_onopenstart(jQuery.proxy(this.openstart_tree, this));
					tree_wdg.set_onopenend(jQuery.proxy(this.openend_tree, this));
				}
				// Show vacation notice on load for the current profile
				this.mail_callRefreshVacationNotice();
				break;
			case 'mail.display':
				var self = this;
				// Prepare display dialog for printing
				// copies iframe content to a DIV, as iframe causes
				// trouble for multipage printing

				jQuery('iframe#mail-display_mailDisplayBodySrc').on('load', function(e)
				{
					// encrypt body if mailvelope is available
					self.mailvelopeAvailable(self.mailvelopeDisplay);
					self.mail_prepare_print();
				
					// Trigger print command if the mail oppend for printing porpuse
					// load event fires twice in IE and the first time the content is not ready
					// Check if the iframe content is loaded then trigger the print command
					if (window.location.search.search('&print=') >= 0 && jQuery(this.contentWindow.document.body).children().length >0 )
					{
						self.mail_print();
					}
				});

				this.mail_isMainWindow = false;
				this.mail_display();

				// Register attachments for drag
				this.register_for_drag(
					this.et2.getArrayMgr("content").getEntry('mail_id'),
					this.et2.getArrayMgr("content").getEntry('mail_displayattachments')
				);
				break;
			case 'mail.compose':
				if (this.et2.getWidgetById('composeToolbar')._actionManager.getActionById('pgp').checked ||
					this.et2.getArrayMgr('content').data.mail_plaintext &&
						this.et2.getArrayMgr('content').data.mail_plaintext.indexOf(this.begin_pgp_message) != -1)
				{
					this.mailvelopeAvailable(this.mailvelopeCompose);
				}
 				// use a wrapper on a different url to be able to use a different fpm pool
				et2.menuaction = 'mail_compose::ajax_send';
				var that = this;
				this.mail_isMainWindow = false;
				this.compose_fieldExpander_init();
				this.check_sharing_filemode();

				this.subject2title();

				// Set autosaving interval to 2 minutes for compose message
				this.W_INTERVALS.push(window.setInterval(function (){
					that.saveAsDraft(null, 'autosaving');
				}, 120000));

				/* Control focus actions on subject to handle expanders properly.*/
				jQuery("#mail-compose_subject").on({
					focus:function(){
						that.compose_fieldExpander_init();
						that.compose_fieldExpander();
					}
				});
				/*Trigger compose_resizeHandler after the CKEditor is fully loaded*/
				jQuery('#mail-compose').on ('load',function() {
					window.setTimeout(function(){that.compose_resizeHandler();}, 300);
				});
				//Resize compose after window resize to not getting scrollbar
				jQuery(window).on ('resize',function() {
					that.compose_resizeHandler();
				});

				this.compose_fieldExpander();

				//Call drag_n_drop initialization for emails on compose
				this.init_dndCompose();

				// Set focus on To/body field
				// depending on To field value
				var to = this.et2.getWidgetById('to');
				if (to && to.get_value() && to.get_value() != '')
				{
					var content = this.et2.getArrayMgr('content').data;
					if (content.is_plain)
					{
						var plainText = this.et2.getWidgetById('mail_plaintext');
						// focus
						jQuery(plainText.node).focus();
						// get the cursor to the top of the textarea
						if (typeof plainText.node.setSelectionRange !='undefined') plainText.node.setSelectionRange(0);
					}
					else
					{
						this.et2.getWidgetById('mail_htmltext').ckeditor.on('instanceReady', function(e) {
							this.focus();
						});
					}
				}
				else if(to)
				{
					jQuery('input',to.node).focus();
				}
				break;
			case 'mail.subscribe':
				if (this.subscription_treeLastState != "")
				{	
					var tree = this.et2.getWidgetById('foldertree');
					//Saved state of tree
					var state = jQuery.parseJSON(this.subscription_treeLastState);
					
					tree.input.loadJSONObject(tree._htmlencode_node(state));
				}
		}
	},

	/**
	 * Observer method receives update notifications from all applications
	 *
	 * App is responsible for only reacting to "messages" it is interested in!
	 *
	 * @param {string} _msg message (already translated) to show, eg. 'Entry deleted'
	 * @param {string} _app application name
	 * @param {(string|number)} _id id of entry to refresh or null
	 * @param {string} _type either 'update', 'edit', 'delete', 'add' or null
	 * - update: request just modified data from given rows.  Sorting is not considered,
	 *		so if the sort field is changed, the row will not be moved.
	 * - edit: rows changed, but sorting may be affected.  Requires full reload.
	 * - delete: just delete the given rows clientside (no server interaction neccessary)
	 * - add: requires full reload for proper sorting
	 * @param {string} _msg_type 'error', 'warning' or 'success' (default)
	 * @param {object|null} _links app => array of ids of linked entries
	 * or null, if not triggered on server-side, which adds that info
	 * @return {false|*} false to stop regular refresh, thought all observers are run
	 */
	observer: function(_msg, _app, _id, _type, _msg_type, _links)
	{
		switch(_app)
		{
			case 'mail':
				if (_id === 'sieve')
				{
					var iframe = this.et2.getWidgetById('extra_iframe');
					if (iframe && iframe.getDOMNode())
					{
						var contentWindow = iframe.getDOMNode().contentWindow;
						if (contentWindow && contentWindow.app && contentWindow.app.mail)
						{
							contentWindow.app.mail.sieve_refresh();
						}
					}
					return false;	// mail nextmatch needs NOT to be refreshed
				}
				break;

			case 'emailadmin':	// update tree with given mail account _id and _type
				var tree = this.et2 ? this.et2.getWidgetById(this.nm_index+'[foldertree]') : null;
				if (!tree) break;
				var node = tree.getNode(_id);
				switch(_type)
				{
					case 'delete':
						if (node)	// we dont care for deleted accounts not shown (eg. other users)
						{
							tree.deleteItem(_id);
							// ToDo: blank list, if _id was active account
						}
						break
					case 'update':
					case 'edit':
						if (node)	// we dont care for updated accounts not shown (eg. other users)
						{
							//tree.refreshItem(_id);
							egw.json('mail.mail_ui.ajax_reloadNode',[_id])
								.sendRequest(true);
						}
						break;
					case 'add':
						tree.refreshItem(0);	// refresh root
						break;
				}
		}
	},

	/**
	 * Callback function for dataFetch caching.
	 *
	 * We only cache the first chunk (50 rows), and only if search filter is not set,
	 * but we cache this for every combination of folder, filter & filter2.
	 *
	 * We do not cache, if we dont find selectedFolder in query_context,
	 * as looking it up in tree causes mails to be cached for wrong folder
	 * (Probably because user already clicked on an other folder)!
	 *
	 * @param {object} query_context Query information from egw.dataFetch()
	 * @returns {string|false} Cache key, or false to not cache
	 */
	nm_cache: function(query_context)
	{
		// Only cache first chunk of rows, if no search filter
		if((!query_context || !query_context.start) && query_context.count == 0 &&
			query_context.filters && query_context.filters.selectedFolder &&
			!(!query_context.filters || query_context.filters.search)
		)
		{
			// Make sure keys match, even if some filters are not defined
			// using JSON.stringfy() directly gave a crash in Safari 7.0.4
			return this.egw.jsonEncode({
				selectedFolder: query_context.filters.selectedFolder || '',
				filter: query_context.filters.filter || '',
				filter2: query_context.filters.filter2 || '',
				sort: query_context.filters.sort
			});
		}
		return false;
	},

	/**
	 * mail rebuild Action menu On nm-list
	 *
	 * @param _actions
	 */
	mail_rebuildActionsOnList: function(_actions)
	{
		this.et2.getWidgetById(this.nm_index).set_actions(_actions);
	},

	/**
	 * mail_fetchCurrentlyFocussed - implementation to decide wich mail of all the selected ones is the current
	 *
	 * @param _selected array of the selected mails
	 * @param _reset bool - tell the function to reset the global vars used
	 */
	mail_fetchCurrentlyFocussed: function(_selected, _reset) {
		// reinitialize the buffer-info on selected mails
		if (_reset == true || typeof _selected == 'undefined')
		{
			if (_reset == true)
			{
				// Request updated data, if possible
				if (this.mail_currentlyFocussed!='') egw.dataRefreshUID(this.mail_currentlyFocussed);
				for(var k = 0; k < this.mail_selectedMails.length; k++) egw.dataRefreshUID(this.mail_selectedMails[k]);
				//nm.refresh(this.mail_selectedMails,'delete');
			}
			this.mail_selectedMails = [];
			this.mail_currentlyFocussed = '';
			return '';
		}
		for(var k = 0; k < _selected.length; k++)
		{
			if (jQuery.inArray(_selected[k],this.mail_selectedMails)==-1)
			{
				this.mail_currentlyFocussed = _selected[k];
				break;
			}
		}
		this.mail_selectedMails = _selected;
		return this.mail_currentlyFocussed;
	},

	/**
	 * mail_open - implementation of the open action
	 *
	 * @param _action
	 * @param _senders - the representation of the elements(s) the action is to be performed on
	 * @param _mode - you may pass the mode. if not given view is used (tryastext|tryashtml are supported)
	 */
	mail_open: function(_action, _senders, _mode) {
		if (typeof _senders == 'undefined' || _senders.length==0)
		{
			if (this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				var _senders = [];
				_senders.push({id:this.et2.getArrayMgr("content").getEntry('mail_id') || ''});
			}
			if ((typeof _senders == 'undefined' || _senders.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					var _senders = [];
					_senders.push({id:this.mail_currentlyFocussed});
				}
			}
		}
		var _id = _senders[0].id;
		// reinitialize the buffer-info on selected mails
		if (!(_mode == 'tryastext' || _mode == 'tryashtml' || _mode == 'view' || _mode == 'print')) _mode = 'view';
		this.mail_selectedMails = [];
		this.mail_selectedMails.push(_id);
		this.mail_currentlyFocussed = _id;

		var dataElem = egw.dataGetUIDdata(_id);
		var subject = dataElem.data.subject;
		//alert('Open Message:'+_id+' '+subject);
		var h = egw().open( _id,'mail','view',_mode+'='+_id.replace(/=/g,"_")+'&mode='+_mode);
		egw(h).ready(function() {
			h.document.title = subject;
		});
		// THE FOLLOWING IS PROBABLY NOT NEEDED, AS THE UNEVITABLE PREVIEW IS HANDLING THE COUNTER ISSUE
		var messages = {};
		messages['msg'] = [_id];
		// When body is requested, mail is marked as read by the mail server.  Update UI to match.
		if (typeof dataElem != 'undefined' && typeof dataElem.data != 'undefined' && typeof dataElem.data.flags != 'undefined' && typeof dataElem.data.flags.read != 'undefined') dataElem.data.flags.read = 'read';
		if (typeof dataElem != 'undefined' && typeof dataElem.data != 'undefined' && typeof dataElem.data['class'] != 'undefined' && (dataElem.data['class'].indexOf('unseen') >= 0 || dataElem.data['class'].indexOf('recent') >= 0))
		{
			this.mail_removeRowClass(messages,'recent');
			this.mail_removeRowClass(messages,'unseen');
			// reduce counter without server roundtrip
			this.mail_reduceCounterWithoutServerRoundtrip();
			// not needed, as an explizit read flags the message as seen anyhow
			//egw.jsonq('mail.mail_ui.ajax_flagMessages',['read', messages, false]);
		}
	},

	/**
	 * Open a single message in html mode
	 *
	 * @param _action
	 * @param _elems _elems[0].id is the row-id
	 */
	mail_openAsHtml: function(_action, _elems)
	{
		this.mail_open(_action, _elems,'tryashtml');
	},

	/**
	 * Open a single message in plain text mode
	 *
	 * @param _action
	 * @param _elems _elems[0].id is the row-id
	 */
	mail_openAsText: function(_action, _elems)
	{
		this.mail_open(_action, _elems,'tryastext');
	},

	/**
	 * Compose, reply or forward a message
	 *
	 * @function
	 * @memberOf mail
	 * @param _action _action.id is 'compose', 'composeasnew', 'reply', 'reply_all' or 'forward' (forward can be multiple messages)
	 * @param _elems _elems[0].id is the row-id
	 */
	mail_compose: function(_action, _elems)
	{
		if (typeof _elems == 'undefined' || _elems.length==0)
		{
			if (this.et2 && this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				var _elems = [];
				_elems.push({id:this.et2.getArrayMgr("content").getEntry('mail_id') || ''});
			}
			if ((typeof _elems == 'undefined' || _elems.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					var _elems = [];
					_elems.push({id:this.mail_currentlyFocussed});
				}
			}
		}
		// Extra info passed to egw.open()
		var settings = {
			// 'Source' Mail UID
			id: '',
			// How to pull data from the Mail IDs for the compose
			from: ''
		};

		// We only handle one for everything but forward
		settings.id = (typeof _elems == 'undefined'?'':_elems[0].id);

		switch(_action.id)
		{
			case 'compose':
				if (_elems.length == 1)
				{
					//mail_parentRefreshListRowStyle(settings.id,settings.id);
				}
				else
				{
					return this.mail_compose('forward',_elems);
				}
				break;
			case 'forward':
			case 'forwardinline':
			case 'forwardasattach':
				if (_elems.length>1||_action.id == 'forwardasattach')
				{
					settings.from = 'forward';
					settings.mode = 'forwardasattach';
					if (typeof _elems != 'undefined' && _elems.length>1)
					{
						for(var j = 1; j < _elems.length; j++)
						settings.id = settings.id + ',' + _elems[j].id;
					}
				}
				else
				{
					settings.from = 'forward';
					settings.mode = 'forwardinline';
				}
				break;
			default:
				// No further client side processing needed for these
				settings.from = _action.id;
		}
		var compose_list = egw.getOpenWindows("mail", /^compose_/);
		var window_name = 'compose_' + compose_list.length + '_'+ (settings.from || '') + '_' + settings.id;
		return egw().open('','mail','add',settings,window_name,'mail');
	},

	/**
	 * Set content into a compose window
	 *
	 * @function
	 * @memberOf mail
	 *
	 * @param {String} window_name The name of an open content window.
	 * @param {object} content
	 *
	 * @description content Data to set into the window's fields
	 * content.to Addresses to add to the to line
	 * content.cc Addresses to add to the CC line
	 * content.bcc Addresses to add to the BCC line
	 *
	 * @return {boolean} Success
	 */
	setCompose: function(window_name, content)
	{
		// Get window
		var compose = window.open('', window_name);
		if(!compose || compose.closed) return false;

		// Get etemplate of popup
		var compose_et2 = compose.etemplate2.getByApplication('mail');
		if(!compose_et2 || compose_et2.length != 1 || !compose_et2[0].widgetContainer)
		{
			return false;
		}

		// Set each field provided
		var success = true;
		var arrContent = [];
		for(var field in content)
		{
			try
			{
				var widget = compose_et2[0].widgetContainer.getWidgetById(field);

				// Merge array values, replace strings
				var value = widget.getValue() || content[field];
				if(jQuery.isArray(value))
				{
					if(jQuery.isArray(content[field]))
					{
						value.concat(content[field]);
					}
					else
					{
						arrContent = content[field].split(',');
						for (var k=0;k < arrContent.length;k++)
						{
							value.push(arrContent[k]);
						}
					}
				}
				widget.set_value(value);
			}
			catch(e)
			{
				egw.log("error", "Unable to set field %s to '%s' in window '%s'", field, content[field],window_name);
				success = false;
				continue;
			}
		}
		if (content['cc'] || content['bcc'])
		{
			this.compose_fieldExpander();
			this.compose_fieldExpander_init();
		}
		return success;
	},

	/**
	 * mail_disablePreviewArea - implementation of the disablePreviewArea action
	 *
	 * @param _value
	 */
	mail_disablePreviewArea: function(_value) {
		var splitter = this.et2.getWidgetById('mailSplitter');
		// return if there's no splitter we maybe in mobile mode
		if (typeof splitter == 'undefined' || splitter == null) return;
		var splitterDN = splitter.getDOMNode();

		if(splitter.isDocked())
		{
			this.mail_previewAreaActive = false;
		}

		//this.et2.getWidgetById('mailPreviewHeadersFrom').set_disabled(_value);
		//this.et2.getWidgetById('mailPreviewHeadersTo').set_disabled(_value);
		//this.et2.getWidgetById('mailPreviewHeadersDate').set_disabled(_value);
		//this.et2.getWidgetById('mailPreviewHeadersSubject').set_disabled(_value);
		this.et2.getWidgetById('mailPreview').set_disabled(_value);
		//Dock the splitter always if we are browsing with mobile
		if (_value==true)
		{
			if (this.mail_previewAreaActive) splitter.dock();
			this.mail_previewAreaActive = false;
		}
		else
		{
			if (!this.mail_previewAreaActive) splitter.undock();
			this.mail_previewAreaActive = true;
		}
	},

	/**
	 * Create an expand on click box
	 *
	 * @param {object} _expContent an object with at least these elements
	 *					{build_children, data_one, data, widget, line}
	 *
	 * @param {object} _dataElem includes data of the widget which need to be expand
	 *
	 * @return _dataElem content of widgets
	 */
	url_email_expandOnClick: function (_expContent, _dataElem)
	{

		for(var j = 0; j < _expContent.length; j++)
		{
			var field = _expContent[j] || [];
			var content = _dataElem.data[field.data] || [];

			// Add in single address, if there
			if(typeof field.data_one != 'undefined' && field.data != field.data_one)
			{
				if (jQuery.isArray(_dataElem.data[field.data_one]))
					content = content.concat(_dataElem.data[field.data_one]);
				else
					content.unshift(_dataElem.data[field.data_one]);
				// Unique
				content = content.filter(function(value, index, self) {
					return self.indexOf(value) === index;
				});
			}

			// Disable whole box if there are none
			var line = this.et2.getWidgetById(field.line);
			if(line != null) line.set_disabled(content.length == 0);

			var widget = this.et2.getWidgetById(field.widget);
			if(widget == null) continue;
			$j(widget.getDOMNode()).removeClass('visible');

			// Programatically build the child elements
			if(field.build_children)
			{
				// Remove any existing
				var children = widget.getChildren();
				for(var i = children.length-1; i >= 0; i--)
				{
					children[i].destroy();
					widget.removeChild(children[i]);
				}
				if (content.length == 1 && typeof content[0] != 'undefined' && content[0])
				{
					content = content[0].split(',');
				}
				// Add for current record
				var remembervalue = '';
				for(var i = 0; i < content.length; i++)
				{
					if (typeof content[i] != 'string' || !content[i]) continue;
					// if there is no @ in string, its most likely that we have a comma in the personal name part of the emailaddress
					if (content[i].indexOf('@')< 0)
					{
						remembervalue = content[i];
					}
					else
					{
						var value = remembervalue+(remembervalue?',':'')+content[i];
						var email = et2_createWidget('url-email',{id:widget.id+'_'+i, value:value,readonly:true, contact_plus:true},widget);
						email.loadingFinished();
						remembervalue = '';
					}
				}
			}
			else
			{
				widget.set_value({content: content});
			}

			// Show or hide button, as needed
			line.iterateOver(function(button) {
				// Avoid binding to any child buttons
				if(button.getParent() != line) return;
				button.set_disabled(
					// Disable if only 1 address
					content.length <=1 || (
					// Disable if all content is visible
					$j(widget.getDOMNode()).innerWidth() >= widget.getDOMNode().scrollWidth &&
					$j(widget.getDOMNode()).innerHeight() >= widget.getDOMNode().scrollHeight)
				);
			},this,et2_button);
		}

		return _dataElem;
	},

	/**
	 * Set values for mail dispaly From,Sender,To,Cc, and Bcc
	 * Additionally, apply expand on click feature on thier widgets
	 *
	 */
	mail_display: function()
	{
		var dataElem = {data:{FROM:"",SENDER:"",TO:"",CC:"",BCC:""}};
		var content = this.et2.getArrayMgr('content').data;
		var expand_content = [
			{build_children: true, data_one: 'FROM', data: 'FROM', widget: 'FROM', line: 'mailDisplayHeadersFrom'},
			{build_children: true,  data: 'SENDER', widget: 'SENDER', line: 'mailDisplayHeadersSender'},
			{build_children: true, data: 'TO', widget: 'TO', line: 'mailDisplayHeadersTo'},
			{build_children: true, data: 'CC', widget: 'CC', line: 'mailDisplayHeadersCc'},
			{build_children: true, data: 'BCC', widget:'BCC', line: 'mailDisplayHeadersBcc'}
		];

		if (typeof  content != 'undefiend')
		{
			dataElem.data = jQuery.extend(dataElem.data, content);

			this.url_email_expandOnClick(expand_content, dataElem);
			var toolbaractions = ((typeof dataElem != 'undefined' && typeof dataElem.data != 'undefined' && typeof dataElem.data.displayToolbaractions != 'undefined')?JSON.parse(dataElem.data.displayToolbaractions):undefined);
			if (toolbaractions) this.et2.getWidgetById('displayToolbar').set_actions(toolbaractions);
		}
	},

	/**
	 * mail_preview - implementation of the preview action
	 *
	 * @param nextmatch et2_nextmatch The widget whose row was selected
	 * @param selected Array Selected row IDs.  May be empty if user unselected all rows.
	 */
	mail_preview: function(selected, nextmatch) {
		// Empty values, just in case selected is empty (user cleared selection)
		//dataElem.data is populated, when available with fromaddress(string),toaddress(string),additionaltoaddress(array),ccaddress (array)
		var dataElem = {data:{subject:"",fromaddress:"",toaddress:"",ccaddress:"",date:"",attachmentsBlock:""}};
		var attachmentArea = this.et2.getWidgetById('previewAttachmentArea');
		if(typeof selected != 'undefined' && selected.length == 1)
		{
			var _id = this.mail_fetchCurrentlyFocussed(selected);
			dataElem = jQuery.extend(dataElem, egw.dataGetUIDdata(_id));
		}

		var $preview_iframe = jQuery('#mail-index_mailPreviewContainer');

		// Re calculate the position of preview iframe according to its visible sibilings
		var set_prev_iframe_top = function ()
		{
			// Need to make sure that the iframe is fullyLoad before calculation
			window.setTimeout(function(){
				var lastEl = $preview_iframe.prev().prev();
				// Top offset of preview iframe calculated from top level
				var iframeTop = $preview_iframe.offset().top;
				while (lastEl.css('display') === "none")
				{
					lastEl = lastEl.prev();
				}
				var offset = iframeTop - (lastEl.offset().top + lastEl.height()) || 130; // fallback to 130 px if can not calculate new top

				// preview iframe parent has position absolute, therefore need to calculate the top via position
				$preview_iframe.css ('top', $preview_iframe.position().top - offset + 10);
			}, 50);
		};

		if (attachmentArea && typeof _id != 'undefined' && _id !='' && typeof dataElem !== 'undefined')
		{
			// If there is content to show recalculate the size
			set_prev_iframe_top();
		}
		else
		{
			// Leave if we're here and there is nothing selected, too many, or no data
			var prevAttchArea = this.et2.getWidgetById('previewAttachmentArea');
			if (prevAttchArea)
			{
				prevAttchArea.set_value({content:[]});
				this.et2.getWidgetById('previewAttachmentArea').set_class('previewAttachmentArea noContent mail_DisplayNone');
				var IframeHandle = this.et2.getWidgetById('messageIFRAME');
				IframeHandle.set_src('about:blank');
				this.mail_disablePreviewArea(true);
			}
			return;
		}

		// Widget ID:data key map of widgets we can directly set from cached data
		var data_widgets = {
			'previewFromAddress':	'fromaddress',
			'previewDate':			'date',
			'previewSubject':		'subject'
		};

		// Set widget values from cached data
		for(var id in data_widgets)
		{
			var widget = this.et2.getWidgetById(id);
			if(widget == null) continue;
			widget.set_value(dataElem.data[data_widgets[id]] || "");
		}

		// Blank first, so we don't show previous email while loading
		var IframeHandle = this.et2.getWidgetById('messageIFRAME');
		IframeHandle.set_src('about:blank');

		// show iframe, in case we hide it from mailvelopes one and remove that
		jQuery(IframeHandle.getDOMNode()).show()
			.next(this.mailvelope_iframe_selector).remove();

		// Set up additional content that can be expanded.
		// We add a new URL widget for each address, so they get all the UI
		// TO addresses have the first one split out, not all together
		// list of keys:
		var expand_content = [
			{build_children: true, data_one: 'toaddress', data: 'additionaltoaddress', widget: 'additionalToAddress', line: 'mailPreviewHeadersTo'},
			{build_children: true, data: 'ccaddress', widget: 'additionalCCAddress', line: 'mailPreviewHeadersCC'},
			{build_children: false, data: 'attachmentsBlock', widget:'previewAttachmentArea', line: 'mailPreviewHeadersAttachments'}
		];

		dataElem = this.url_email_expandOnClick(expand_content,dataElem);


		// Update the internal list of selected mails, if needed
		if(this.mail_selectedMails.indexOf(_id) < 0)
		{
			this.mail_selectedMails.push(_id);
		}
		this.mail_disablePreviewArea(false);

		// Request email body from server
		IframeHandle.set_src(egw.link('/index.php',{menuaction:'mail.mail_ui.loadEmailBody',_messageID:_id}));

		var messages = {};
		messages['msg'] = [_id];

		// When body is requested, mail is marked as read by the mail server.  Update UI to match.
		if (typeof dataElem != 'undefined' && typeof dataElem.data != 'undefined' && typeof dataElem.data.flags != 'undefined' && typeof dataElem.data.flags.read != 'undefined') dataElem.data.flags.read = 'read';
		if (typeof dataElem != 'undefined' && typeof dataElem.data != 'undefined' && typeof dataElem.data['class']  != 'undefined' && (dataElem.data['class'].indexOf('unseen') >= 0 || dataElem.data['class'].indexOf('recent') >= 0))
		{
			this.mail_removeRowClass(messages,'recent');
			this.mail_removeRowClass(messages,'unseen');
			// reduce counter without server roundtrip
			this.mail_reduceCounterWithoutServerRoundtrip();
			if (typeof dataElem.data.dispositionnotificationto != 'undefined' && dataElem.data.dispositionnotificationto &&
				typeof dataElem.data.flags.mdnsent == 'undefined' && typeof dataElem.data.flags.mdnnotsent == 'undefined')
			{
				var buttons = [
					{text: this.egw.lang("Yes"), id: "mdnsent"},
					{text: this.egw.lang("No"), id:"mdnnotsent"}
				];
				et2_dialog.show_dialog(function(_button_id, _value) {
					switch (_button_id)
					{
						case "mdnsent":
							egw.jsonq('mail.mail_ui.ajax_sendMDN',[messages]);
							egw.jsonq('mail.mail_ui.ajax_flagMessages',['mdnsent', messages, true]);
							return;
						case "mdnnotsent":
							egw.jsonq('mail.mail_ui.ajax_flagMessages',['mdnnotsent', messages, true]);
					}
				},
				this.egw.lang("The message sender has requested a response to indicate that you have read this message. Would you like to send a receipt?"),
				this.egw.lang("Confirm"),
				messages, buttons);
			}
			egw.jsonq('mail.mail_ui.ajax_flagMessages',['read', messages, false]);
		}
	},

	/**
	 * If a preview header is partially hidden, this is the handler for clicking the
	 * expand button that shows all the content for that header.
	 * The button must be directly after the widget to be expanded in the template.
	 * The widget to be expended is set in the event data.
	 *
	 * requires: mainWindow, one mail selected for preview
	 *
	 * @param {jQuery event} event
	 * @param {Object} widget
	 * @param {DOMNode} button
	 */
	showAllHeader: function(event,widget,button) {
		// Show list as a list
		var list = jQuery(button).prev();
	/*	if (list.length <= 0)
		{
			list = jQuery(button.target).prev();
		}*/

		list.toggleClass('visible');

		// Revert if user clicks elsewhere
		$j('body').one('click', list, function(ev) {
			ev.data.removeClass('visible');
		});
	},

	mail_setMailBody: function(content) {
		var IframeHandle = this.et2.getWidgetById('messageIFRAME');
		IframeHandle.set_value('');
	},

	/**
	 * mail_refreshFolderStatus, function to call to read the counters of a folder and apply them
	 *
	 * @param {stirng} _nodeID
	 * @param {string} mode
	 * @param {boolean} _refreshGridArea
	 * @param {boolean} _refreshQuotaDisplay
	 *
	 */
	mail_refreshFolderStatus: function(_nodeID,mode,_refreshGridArea,_refreshQuotaDisplay) {
		if (typeof _nodeID != 'undefined' && typeof _nodeID[_nodeID] != 'undefined' && _nodeID[_nodeID])
		{
			_refreshGridArea = _nodeID[_refreshGridArea];
			mode = _nodeID[mode];
			_nodeID = _nodeID[_nodeID];
		}
		var nodeToRefresh = 0;
		var mode2use = "none";
		if (typeof _refreshGridArea == 'undefined') _refreshGridArea=true;
		if (typeof _refreshQuotaDisplay == 'undefined') _refreshQuotaDisplay=true;
		if (_nodeID) nodeToRefresh = _nodeID;
		if (mode) {
			if (mode == "forced") {mode2use = mode;}
		}
		try
		{
			var tree_wdg = this.et2.getWidgetById(this.nm_index+'[foldertree]');

			var activeFolders = tree_wdg.getTreeNodeOpenItems(nodeToRefresh,mode2use);
			//alert(activeFolders.join('#,#'));
			this.mail_queueRefreshFolderList((mode=='thisfolderonly'&&nodeToRefresh?[_nodeID]:activeFolders));
			if (_refreshGridArea)
			{
				// maybe to use the mode forced as trigger for grid reload and using the grids own autorefresh
				// would solve the refresh issue more accurately
				//if (mode == "forced") this.mail_refreshMessageGrid();
				this.mail_refreshMessageGrid();
			}
			if (_refreshQuotaDisplay)
			{
				this.mail_refreshQuotaDisplay();
			}
			//the two lines below are not working yet.
			//var no =tree_wdg.getSelectedNode();
			//tree_wdg.focusItem(no.id);
		} catch(e) { } // ignore the error; maybe the template is not loaded yet
	},

	/**
	 * mail_refreshQuotaDisplay, function to call to read the quota for the active server
	 *
	 * @param {object} _server
	 *
	 */
	mail_refreshQuotaDisplay: function(_server)
	{
		egw.json('mail.mail_ui.ajax_refreshQuotaDisplay',[_server])
			.sendRequest(true);
	},

	/**
	 * mail_setQuotaDisplay, function to call to read the quota for the active server
	 *
	 * @param {object} _data
	 *
	 */
	mail_setQuotaDisplay: function(_data)
	{
		if (!this.et2 && !this.checkET2()) return;

		var quotabox = this.et2.getWidgetById(this.nm_index+'[quotainpercent]');

		// Check to make sure it's there
		if(quotabox)
		{
			//try to set it via set_value and set label
			quotabox.set_class(_data.data.quotaclass);
			quotabox.set_value(_data.data.quotainpercent);
			quotabox.set_label(_data.data.quota);
		}
	},

	/**
	 * mail_callRefreshVacationNotice, function to call the serverside function to refresh the vacationnotice for the active server
	 *
	 * @param {object} _server
	 *
	 */
	mail_callRefreshVacationNotice: function(_server)
	{
		egw.jsonq('mail_ui::ajax_refreshVacationNotice',[_server]);
	},
	/**
	 * Make sure attachments have all needed data, so they can be found for
	 * HTML5 native dragging
	 *
	 * @param {string} mail_id Mail UID
	 * @param {array} attachments Attachment information.
	 */
	register_for_drag: function(mail_id, attachments)
	{
		// Put required info in global store
		var data = {};
		if (!attachments) return;
		for (var i = 0; i < attachments.length; i++)
		{
			var data = attachments[i] || {};
			if(!data.filename || !data.type) continue;

			// Add required info
			data.mime = data.type;
			data.download_url = egw.link('/index.php', {
				menuaction: 'mail.mail_ui.getAttachment',
				id: mail_id,
				part: data.partID,
				is_winmail: data.winmailFlag
			});
			data.name = data.filename;
		}
	},

	/**
	 * Display helper for dragging attachments
	 *
	 * @param {egwAction} _action
	 * @param {egwActionElement[]} _elems
	 * @returns {DOMNode}
	 */
	drag_attachment: function(_action, _elems)
	{
		var div = $j(document.createElement("div"))
			.css({
				position: 'absolute',
				top: '0px',
				left: '0px',
				width: '300px'
			});

		var data = _elems[0].data || {};

		var text = $j(document.createElement('div')).css({left: '30px', position: 'absolute'});
		// add filename or number of files for multiple files
		text.text(_elems.length > 1 ? _elems.length+' '+this.egw.lang('files') : data.name || '');
		div.append(text);

		// Add notice of Ctrl key, if supported
		if(window.FileReader && 'draggable' in document.createElement('span') &&
			navigator && navigator.userAgent.indexOf('Chrome') >= 0)
		{
			var key = ["Mac68K","MacPPC","MacIntel"].indexOf(window.navigator.platform) < 0 ? 'Ctrl' : 'Command';
			text.append('<br />' + this.egw.lang('Hold %1 to drag files to your computer',key));
		}
		return div;
	},

	/**
	 * mail_refreshVacationNotice, function to call with appropriate data to refresh the vacationnotice for the active server
	 *
	 * @param {object} _data
	 *
	 */
	mail_refreshVacationNotice: function(_data)
	{
		if (!this.et2 && !this.checkET2()) return;
		if (_data == null)
		{
			this.et2.getWidgetById(this.nm_index+'[vacationnotice]').set_value('');
			this.et2.getWidgetById(this.nm_index+'[vacationrange]').set_value('');
		}
		else
		{
			this.et2.getWidgetById(this.nm_index+'[vacationnotice]').set_value(_data.vacationnotice);
			this.et2.getWidgetById(this.nm_index+'[vacationrange]').set_value(_data.vacationrange);
		}
	},

	/**
	 * mail_refreshFilter2Options, function to call with appropriate data to refresh the filter2 options for the active server
	 *
	 * @param {object} _data
	 *
	 */
	mail_refreshFilter2Options: function(_data)
	{
		//alert('mail_refreshFilter2Options');
		if (_data == null) return;
		if (!this.et2 && !this.checkET2()) return;

		var filter2 = this.et2.getWidgetById('filter2');
		var current = filter2.value;
		var currentexists=false;
		for (var k in _data)
		{
			if (k==current) currentexists=true;
		}
		if (!currentexists) filter2.set_value('subject');
		filter2.set_select_options(_data);
	},

	/**
	 * mail_refreshFilterOptions, function to call with appropriate data to refresh the filter options for the active server
	 *
	 * @param {object} _data
	 *
	 */
	mail_refreshFilterOptions: function(_data)
	{
		//alert('mail_refreshFilterOptions');
		if (_data == null) return;
		if (!this.et2 && !this.checkET2()) return;

		var filter = this.et2.getWidgetById('filter');
		var current = filter.value;
		var currentexists=false;
		for (var k in _data)
		{
			if (k==current) currentexists=true;
		}
		if (!currentexists) filter.set_value('any');
		filter.set_select_options(_data);

	},

	/**
	 * Queues a refreshFolderList request for 10ms. Actually this will just execute the
	 * code after the calling script has finished.
	 *
	 * @param {array} _folders description
	 */
	mail_queueRefreshFolderList: function(_folders)
	{
		var self = this;
		// as jsonq is too fast wrap it to be delayed a bit, to ensure the folder actions
		// are executed last of the queue
		window.setTimeout(function() {
			egw.jsonq('mail.mail_ui.ajax_setFolderStatus',[_folders], function (){self.unlock_tree();});
		}, 100);
	},

	/**
	 * mail_CheckFolderNoSelect - implementation of the mail_CheckFolderNoSelect action to control right click options on the tree
	 *
	 * @param {object} action
	 * @param {object} _senders the representation of the tree leaf to be manipulated
	 * @param {object} _currentNode
	 */
	mail_CheckFolderNoSelect: function(action,_senders,_currentNode) {

		// Abort if user selected an un-selectable node
		// Use image over anything else because...?
		var ftree, node;
		ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		if (ftree)
		{
			node = ftree.getNode(_senders[0].id);
		}

		if (node && node.im0.indexOf('NoSelect') !== -1)
		{
			//ftree.reSelectItem(_previous);
			return false;
		}

		return true;
	},

	/**
	 * Check if SpamFolder is enabled on that account
	 *
	 * SpamFolder enabled is stored as data { spamfolder: true/false } on account node.
	 *
	 * @param {object} _action
	 * @param {object} _senders the representation of the tree leaf to be manipulated
	 * @param {object} _currentNode
	 */
	spamfolder_enabled: function(_action,_senders,_currentNode)
	{
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var acc_id = _senders[0].id.split('::')[0];
		var node = ftree ? ftree.getNode(acc_id) : null;

		return node && node.data && node.data.spamfolder;
	},


	/**
	 * Check if Sieve is enabled on that account
	 *
	 * Sieve enabled is stored as data { acl: true/false } on account node.
	 *
	 * @param {object} _action
	 * @param {object} _senders the representation of the tree leaf to be manipulated
	 * @param {object} _currentNode
	 */
	sieve_enabled: function(_action,_senders,_currentNode)
	{
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var acc_id = _senders[0].id.split('::')[0];
		var node = ftree ? ftree.getNode(acc_id) : null;

		return node && node.data && node.data.sieve;
	},

	/**
	 * Check if ACL is enabled on that account
	 *
	 * ACL enabled is stored as data { acl: true/false } on INBOX node.
	 * We also need to check if folder is marked as no-select!
	 *
	 * @param {object} _action
	 * @param {object} _senders the representation of the tree leaf to be manipulated
	 * @param {object} _currentNode
	 */
	acl_enabled: function(_action,_senders,_currentNode)
	{
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var inbox = _senders[0].id.split('::')[0]+'::INBOX';
		var node = ftree ? ftree.getNode(inbox) : null;

		return node && node.data.acl && this.mail_CheckFolderNoSelect(_action,_senders,_currentNode);
	},

	/**
	 * mail_setFolderStatus, function to set the status for the visible folders
	 *
	 * @param {array} _status
	 */
	mail_setFolderStatus: function(_status) {
		if (!this.et2 && !this.checkET2()) return;
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		for (var i in _status) {
			ftree.setLabel(i,_status[i]);
			// display folder-name bold for unseen mails
			ftree.setStyle(i, 'font-weight: '+(_status[i].match(this._unseen_regexp) ? 'bold' : 'normal'));
			//alert(i +'->'+_status[i]);
		}
	},

	/**
	 * mail_setLeaf, function to set the id and description for the folder given by status key
	 * @param {array} _status status array with the required data (new id, desc, old desc)
	 *		key is the original id of the leaf to change
	 *		multiple sets can be passed to mail_setLeaf
	 */
	mail_setLeaf: function(_status) {
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var selectedNode = ftree.getSelectedNode();
		for (var i in _status)
		{
			// if olddesc is undefined or #skip# then skip the message, as we process subfolders
			if (typeof _status[i]['olddesc'] !== 'undefined' && _status[i]['olddesc'] !== '#skip-user-interaction-message#') this.egw.message(this.egw.lang("Renamed Folder %1 to %2",_status[i]['olddesc'],_status[i]['desc']));
			ftree.renameItem(i,_status[i]['id'],_status[i]['desc']);
			ftree.setStyle(i, 'font-weight: '+(_status[i]['desc'].match(this._unseen_regexp) ? 'bold' : 'normal'));
			//alert(i +'->'+_status[i]['id']+'+'+_status[i]['desc']);
			if (_status[i]['id']==selectedNode.id)
			{
				var nm = this.et2.getWidgetById(this.nm_index);
				nm.activeFilters["selectedFolder"] = _status[i]['id'];
				nm.applyFilters();
			}
		}
	},

	/**
	 * mail_removeLeaf, function to remove the leaf represented by the given ID
	 * @param {array} _status status array with the required data (KEY id, VALUE desc)
	 *		key is the id of the leaf to delete
	 *		multiple sets can be passed to mail_deleteLeaf
	 */
	mail_removeLeaf: function(_status) {
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var selectedNode = ftree.getSelectedNode();
		for (var i in _status)
		{
			// if olddesc is undefined or #skip# then skip the message, as we process subfolders
			if (typeof _status[i] !== 'undefined' && _status[i] !== '#skip-user-interaction-message#') this.egw.message(this.egw.lang("Removed Folder %1 ",_status[i]));
			ftree.deleteItem(i,(selectedNode.id==i));
			var selectedNodeAfter = ftree.getSelectedNode();
			//alert(i +'->'+_status[i]['id']+'+'+_status[i]['desc']);
			if (selectedNodeAfter.id!=selectedNode.id && selectedNode.id==i)
			{
				var nm = this.et2.getWidgetById(this.nm_index);
				nm.activeFilters["selectedFolder"] = selectedNodeAfter.id;
				nm.applyFilters();
			}
		}
	},

	/**
	 * mail_reloadNode, function to reload the leaf represented by the given ID
	 * @param {Object.<string,string>|Object.<string,Object}}  _status
	 *		Object with the required data (KEY id, VALUE desc), or ID => {new data}
	 */
	mail_reloadNode: function(_status) {
		var ftree = this.et2?this.et2.getWidgetById(this.nm_index+'[foldertree]'):null;
		if (!ftree) return;
		var selectedNode = ftree.getSelectedNode();
		for (var i in _status)
		{
			// if olddesc is undefined or #skip# then skip the message, as we process subfolders
			if (typeof _status[i] !== 'undefined' && _status[i] !== '#skip-user-interaction-message#')
			{
				this.egw.message(this.egw.lang("Reloaded Folder %1 ",typeof _status[i] == "string" ? _status[i].replace(this._unseen_regexp, '') : _status[i].text.replace(this._unseen_regexp, '')));
			}
			ftree.refreshItem(i,typeof _status[i] == "object" ? _status[i] : null);
			if (typeof _status[i] == "string") ftree.setStyle(i, 'font-weight: '+(_status[i].match(this._unseen_regexp) ? 'bold' : 'normal'));
		}

		var selectedNodeAfter = ftree.getSelectedNode();

		// If selected folder changed, refresh nextmatch
		if (selectedNodeAfter != null && selectedNodeAfter.id!=selectedNode.id)
		{
			var nm = this.et2.getWidgetById(this.nm_index);
			nm.activeFilters["selectedFolder"] = selectedNodeAfter.id;
			nm.applyFilters();
		}
	},

	/**
	 * mail_refreshMessageGrid, function to call to reread ofthe current folder
	 *
	 * @param {boolean} _isPopup
	 */
	mail_refreshMessageGrid: function(_isPopup) {
		if (typeof _isPopup == 'undefined') _isPopup = false;
		var nm;
		if (_isPopup && !this.mail_isMainWindow)
		{
			nm = window.opener.etemplate2.getByApplication('mail')[0].widgetContainer.getWidgetById(this.nm_index);
		}
		else
		{
			nm = this.et2.getWidgetById(this.nm_index);
		}
		nm.applyFilters(); // this should refresh the active folder
	},

	/**
	 * mail_getMsg - gets the current Message
	 * @return string
	 */
	mail_getMsg: function()
	{
		var msg_wdg = this.et2.getWidgetById('msg');
		if (msg_wdg)
		{
			return msg_wdg.valueOf().htmlNode[0].innerHTML;
		}
		return "";
	},

	/**
	 * mail_setMsg - sets a Message, with the msg container, and controls if the container is enabled/disabled
	 * @param {string} myMsg - the message
	 */
	mail_setMsg: function(myMsg)
	{
		var msg_wdg = this.et2.getWidgetById('msg');
		if (msg_wdg)
		{
			msg_wdg.set_value(myMsg);
			msg_wdg.set_disabled(myMsg.trim().length==0);
		}
	},

	/**
	 * Delete mails
	 * takes in all arguments
	 * @param _action
	 * @param _elems
	 */
	mail_delete: function(_action,_elems)
	{
		this.mail_checkAllSelected(_action,_elems,null,true);
	},

	/**
	 * call Delete mails
	 * takes in all arguments
	 * @param {object} _action
	 * @param {array} _elems
	 * @param {boolean} _allMessagesChecked
	 */
	mail_callDelete: function(_action,_elems,_allMessagesChecked)
	{
		var calledFromPopup = false;
		if (typeof _allMessagesChecked == 'undefined') _allMessagesChecked=false;
		if (typeof _elems == 'undefined' || _elems.length==0)
		{
			calledFromPopup = true;
			if (this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				var _elems = [];
				_elems.push({id:this.et2.getArrayMgr("content").getEntry('mail_id') || ''});
			}
			if ((typeof _elems == 'undefined' || _elems.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					var _elems = [];
					_elems.push({id:this.mail_currentlyFocussed});
				}
			}
		}
		var msg = this.mail_getFormData(_elems);
		msg['all'] = _allMessagesChecked;
		if (msg['all']=='cancel') return false;
		if (msg['all']) msg['activeFilters'] = this.mail_getActiveFilters(_action);
		//alert(_action.id+','+ msg);
		if (!calledFromPopup) this.mail_setRowClass(_elems,'deleted');
		this.mail_deleteMessages(msg,'no',calledFromPopup);
		if (calledFromPopup && this.mail_isMainWindow==false) egw(window).close();
	},

	/**
	 * function to find (and reduce) unseen count from folder-name
	 */
	mail_reduceCounterWithoutServerRoundtrip: function()
	{
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var _foldernode = ftree.getSelectedNode();
		var counter = _foldernode.label.match(this._unseen_regexp);
		var icounter = 0;
		if ( counter ) icounter = parseInt(counter[0].replace(' (','').replace(')',''));
		if (icounter>0)
		{
			var newcounter = icounter-1;
			if (newcounter>0) _foldernode.label = _foldernode.label.replace(' ('+String(icounter)+')',' ('+String(newcounter)+')');
			if (newcounter==0) _foldernode.label = _foldernode.label.replace(' ('+String(icounter)+')','');
			ftree.setLabel(_foldernode.id,_foldernode.label);
		}
	},

	/**
	 * Regular expression to find (and remove) unseen count from folder-name
	 */
	_unseen_regexp: / \([0-9]+\)$/,

	/**
	 * mail_splitRowId
	 *
	 * @param {string} _rowID
	 *
	 */
	mail_splitRowId: function(_rowID)
	{
		var res = _rowID.split('::');
		// as a rowID is perceeded by app::, should be mail!
		if (res.length==4 && !isNaN(parseInt(res[0])))
		{
			// we have an own created rowID; prepend app=mail
			res.unshift('mail');
		}
		return res;
	},

	/**
	 * Delete mails - actually calls the backend function for deletion
	 * takes in all arguments
	 * @param {string} _msg - message list
	 * @param {object} _action - optional action
	 * @param {object} _calledFromPopup
	 */
	mail_deleteMessages: function(_msg,_action,_calledFromPopup)
	{
		var message, ftree, _foldernode, displayname;
		ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		if (ftree)
		{
			_foldernode = ftree.getSelectedNode();

			displayname = _foldernode.label.replace(this._unseen_regexp, '');
		}
		else
		{
			message = this.mail_splitRowId(_msg['msg'][0]);
			if (message[3]) _foldernode = displayname = jQuery.base64Decode(message[3]);
		}

		// Tell server
		egw.json('mail.mail_ui.ajax_deleteMessages',[_msg,(typeof _action == 'undefined'?'no':_action)])
			.sendRequest(true);

		if (_msg['all']) this.egw.refresh(this.egw.lang("deleted %1 messages in %2",(_msg['all']?egw.lang('all'):_msg['msg'].length),(displayname?displayname:egw.lang('current folder'))),'mail');//,ids,'delete');
		this.egw.message(this.egw.lang("deleted %1 messages in %2",(_msg['all']?egw.lang('all'):_msg['msg'].length),(displayname?displayname:egw.lang('current Folder'))));
	},

	/**
	 * Delete mails show result - called from the backend function for display of deletionmessages
	 * takes in all arguments
	 * @param _msg - message list
	 */
	mail_deleteMessagesShowResult: function(_msg)
	{
		// Update list
		var ids = [];
		for (var i = 0; i < _msg['msg'].length; i++)
		{
			ids.push(_msg['msg'][i].replace(/mail::/,''));
		}
		//this.egw.message(_msg['egw_message']);
		if (_msg['all'])
		{
			this.egw.refresh(_msg['egw_message'],'mail');
		}
		else
		{
			this.egw.refresh(_msg['egw_message'],'mail',ids,'delete');

			// Nextmatch automatically selects the next row and calls preview.
			// Unselect it and thanks to the timeout selectionMgr uses, preview
			// will close when the selection callback fires.
			this.et2.getWidgetById(this.nm_index).controller._selectionMgr.resetSelection();
		}
	},

	/**
	 * retry to Delete mails
	 * @param responseObject ->
	 * 	 reason - reason to report
	 * 	 messageList
	 */
	mail_retryForcedDelete: function(responseObject)
	{
		var reason = responseObject['response'];
		var messageList = responseObject['messageList'];
		if (confirm(reason))
		{
			this.mail_deleteMessages(messageList,'remove_immediately');
		}
		else
		{
			this.egw.message(this.egw.lang('canceled deletion due to userinteraction'));
			this.mail_removeRowClass(messageList,'deleted');
		}
		this.mail_refreshMessageGrid();
		this.mail_preview();
	},

	/**
	 * UnDelete mailMessages
	 *
	 * @param _messageList
	 */
	mail_undeleteMessages: function(_messageList) {
	// setting class of row, the old style
	},

	/**
	 * mail_emptySpam
	 *
	 * @param {object} action
	 * @param {object} _senders
	 */
	mail_emptySpam: function(action,_senders) {
		var server = _senders[0].iface.id.split('::');
		var activeFilters = this.mail_getActiveFilters();
		var self = this;

		this.egw.message(this.egw.lang('empty junk'));
		egw.json('mail.mail_ui.ajax_emptySpam',[server[0], activeFilters['selectedFolder']? activeFilters['selectedFolder']:null],function(){self.unlock_tree();})
			.sendRequest(true);

		// Directly delete any trash cache for selected server
		if(window.localStorage)
		{
			for(var i = 0; i < window.localStorage.length; i++)
			{
				var key = window.localStorage.key(i);

				// Find directly by what the key would look like
				if(key.indexOf('cached_fetch_mail::{"selectedFolder":"'+server[0]+'::') == 0 &&
					key.toLowerCase().indexOf(egw.lang('junk').toLowerCase()) > 0)
				{
					window.localStorage.removeItem(key);
				}
			}
		}
	},

	/**
	 * mail_emptyTrash
	 *
	 * @param {object} action
	 * @param {object} _senders
	 */
	mail_emptyTrash: function(action,_senders) {
		var server = _senders[0].iface.id.split('::');
		var activeFilters = this.mail_getActiveFilters();
		var self = this;

		this.egw.message(this.egw.lang('empty trash'));
		egw.json('mail.mail_ui.ajax_emptyTrash',[server[0], activeFilters['selectedFolder']? activeFilters['selectedFolder']:null],function(){self.unlock_tree();})
			.sendRequest(true);

		// Directly delete any trash cache for selected server
		if(window.localStorage)
		{
			for(var i = 0; i < window.localStorage.length; i++)
			{
				var key = window.localStorage.key(i);

				// Find directly by what the key would look like
				if(key.indexOf('cached_fetch_mail::{"selectedFolder":"'+server[0]+'::') == 0 &&
					key.toLowerCase().indexOf(egw.lang('trash').toLowerCase()) > 0)
				{
					window.localStorage.removeItem(key);
				}
			}
		}
	},

	/**
	 * mail_compressFolder
	 *
	 * @param {object} action
	 * @param {object} _senders
	 *
	 */
	mail_compressFolder: function(action,_senders) {
		this.egw.message(this.egw.lang('compress folder'));
		egw.jsonq('mail.mail_ui.ajax_compressFolder',[_senders[0].iface.id]);
		//	.sendRequest(true);
		// since the json reply is using this.egw.refresh, we should not need to call refreshFolderStatus
		// as the actions thereof are now bound to run after grid refresh
		//this.mail_refreshFolderStatus();
	},

	/**
	 * mail_changeProfile
	 *
	 * @param {string} folder the ID of the selected Node -> should be an integer
	 * @param {object} _widget handle to the tree widget
	 * @param {boolean} getFolders Flag to indicate that the profile needs the mail
	 *		folders.  False means they're already loaded in the tree, and we don't need
	 *		them again
	 */
	mail_changeProfile: function(folder,_widget, getFolders) {
		if(typeof getFolders == 'undefined')
		{
			getFolders = true;
		}
	//	alert(folder);
		this.egw.message(this.egw.lang('Connect to Profile %1',_widget.getSelectedLabel().replace(this._unseen_regexp, '')));
		
		//Open unloaded tree to get loaded
		_widget.openItem(folder, true);
		
		this.lock_tree();
		egw.json('mail_ui::ajax_changeProfile',[folder, getFolders, this.et2._inst.etemplate_exec_id], jQuery.proxy(function() {
			// Profile changed, select inbox
			var inbox = folder + '::INBOX';
			_widget.reSelectItem(inbox);
			this.mail_changeFolder(inbox,_widget,'');
			this.unlock_tree();
		},this))
			.sendRequest(true);

		return true;
	},

	/**
	 * mail_changeFolder
	 * @param {string} _folder the ID of the selected Node
	 * @param {widget object} _widget handle to the tree widget
	 * @param {string} _previous - Previously selected node ID
	 */
	mail_changeFolder: function(_folder,_widget, _previous) {

		// to reset iframes to the normal status
		this.loadIframe();

		// Abort if user selected an un-selectable node
		// Use image over anything else because...?
		var img = _widget.getSelectedNode().images[0];
		if (img.indexOf('NoSelect') !== -1)
		{
			_widget.reSelectItem(_previous);
			return;
		}

		// Check if this is a top level node and
		// change profile if server has changed
		var server = _folder.split('::');
		var previousServer = _previous.split('::');
		var profile_selected = (_folder.indexOf('::') === -1);
		if (server[0] != previousServer[0] && profile_selected)
		{
			// mail_changeProfile triggers a refresh, no need to do any more
			return this.mail_changeProfile(_folder,_widget, _widget.getSelectedNode().childsCount == 0);
		}

		// Apply new selected folder to list, which updates data
		var nm = _widget.getRoot().getWidgetById(this.nm_index);
		if(nm)
		{
			this.lock_tree();
			nm.applyFilters({'selectedFolder': _folder});
		}

		// Get nice folder name for message, if selected is not a profile
		if(!profile_selected)
		{
			var displayname = _widget.getSelectedLabel();
			var myMsg = (displayname?displayname:_folder).replace(this._unseen_regexp, '')+' '+this.egw.lang('selected');
			this.egw.message(myMsg);
		}

		// Update non-grid
		this.mail_refreshFolderStatus(_folder,'forced',false,false);
		this.mail_refreshQuotaDisplay(server[0]);
		this.mail_preview();
		if (server[0]!=previousServer[0])
		{
			this.mail_callRefreshVacationNotice(server[0]);
			egw.jsonq('mail.mail_ui.ajax_refreshFilters',[server[0]]);
		}
	},

	/**
	 * mail_checkAllSelected
	 *
	 * @param _action
	 * @param _elems
	 * @param _target
	 * @param _confirm
	 */
	mail_checkAllSelected: function(_action, _elems, _target, _confirm)
	{
		if (typeof _confirm == 'undefined') _confirm = false;
		// we can NOT query global object manager for this.nm_index="nm", as we might not get the one from mail,
		// if other tabs are open, we have to query for obj_manager for "mail" and then it's child with id "nm"
		var obj_manager = egw_getObjectManager(this.appname).getObjectById(this.nm_index);
		var that = this;
		var rvMain = false;
		if ((obj_manager && _elems.length>1 && obj_manager.getAllSelected() && !_action.paste) || _action.id=='readall')
		{
			if (_confirm)
			{
				var buttons = [
					{text: this.egw.lang("Yes"), id: "all", "class": "ui-priority-primary", "default": true},
					{text: this.egw.lang("Cancel"), id:"cancel"}
				];
				var messageToDisplay = '';
				switch (_action.id)
				{
					case "readall":
						messageToDisplay = this.egw.lang("Do you really want to mark ALL messages as read in the current folder?")+" ";
						break;
					case "unlabel":
					case "label1":
					case "label2":
					case "label3":
					case "label4":
					case "label5":
					case "flagged":
					case "read":
					case "undelete":
						messageToDisplay = this.egw.lang("Do you really want to toggle flag %1 for ALL messages in the current view?",this.egw.lang(_action.id))+" ";
						break;
					default:
						var type = null;
						if (_action.id.substr(0,4)=='move' || _action.id === "drop_move_mail")
						{
							type = 'Move';
						}
						if (_action.id.substr(0,4)=='copy' || _action.id === "drop_copy_mail")
						{
							type = 'Copy';
						}
						messageToDisplay = this.egw.lang("Do you really want to apply %1 to ALL messages in the current view?",this.egw.lang(type?type:_action.id))+" ";
				}
				return et2_dialog.show_dialog(function(_button_id) {
					var rv = false;
					switch (_button_id)
					{
						case "all":
							rv = true;
							break;
						case "cancel":
							rv = 'cancel';
					}
					if (rv !="cancel") that.lock_tree();
					switch (_action.id)
					{
						case "delete":
							that.mail_callDelete(_action, _elems,rv);
							break;
						case "readall":
						case "unlabel":
						case "label1":
						case "label2":
						case "label3":
						case "label4":
						case "label5":
						case "flagged":
						case "read":
						case "undelete":
							that.mail_callFlagMessages(_action, _elems,rv);
							break;
						case "drop_move_mail":
							that.mail_callMove(_action, _elems,_target, rv);
							break;
						case "drop_copy_mail":
							that.mail_callCopy(_action, _elems,_target, rv);
							break;
						default:
							if (_action.id.substr(0,4)=='move') that.mail_callMove(_action, _elems,_target, rv);
							if (_action.id.substr(0,4)=='copy') that.mail_callCopy(_action, _elems,_target, rv);
					}
				},
				messageToDisplay,
				this.egw.lang("Confirm"),
				_action.id, buttons);
			}
			else
			{
				rvMain = true;
			}
		}
		switch (_action.id)
		{
			case "delete":
				this.mail_callDelete(_action, _elems,rvMain);
				break;
			case "unlabel":
			case "label1":
			case "label2":
			case "label3":
			case "label4":
			case "label5":
			case "flagged":
			case "read":
			case "undelete":
				this.mail_callFlagMessages(_action, _elems,rvMain);
				break;
			case "drop_move_mail":
				this.mail_callMove(_action, _elems,_target, rvMain);
				break;
			case "drop_copy_mail":
				this.mail_callCopy(_action, _elems,_target, rvMain);
				break;
			default:
				if (_action.id.substr(0,4)=='move') this.mail_callMove(_action, _elems,_target, rvMain);
				if (_action.id.substr(0,4)=='copy') this.mail_callCopy(_action, _elems,_target, rvMain);
		}
	},

	/**
	 * mail_doActionCall
	 *
	 * @param _action
	 * @param _elems
	 */
	mail_doActionCall: function(_action, _elems)
	{
	},

	/**
	 * mail_getActiveFilters
	 *
	 * @param _action
	 * @return mixed boolean/activeFilters object
	 */
	mail_getActiveFilters: function(_action)
	{
		// we can NOT query global object manager for this.nm_index="nm", as we might not get the one from mail,
		// if other tabs are open, we have to query for obj_manager for "mail" and then it's child with id "nm"
		var obj_manager = egw_getObjectManager(this.appname).getObjectById(this.nm_index);
		if (obj_manager && obj_manager.manager && obj_manager.manager.data && obj_manager.manager.data.nextmatch && obj_manager.manager.data.nextmatch.activeFilters)
		{
			return obj_manager.manager.data.nextmatch.activeFilters;
		}
		return false;
	},

	/**
	 * Flag mail as 'read', 'unread', 'flagged' or 'unflagged'
	 *
	 * @param _action _action.id is 'read', 'unread', 'flagged' or 'unflagged'
	 * @param _elems
	 */
	mail_flag: function(_action, _elems)
	{
		this.mail_checkAllSelected(_action,_elems,null,true);
	},

	/**
	 * Flag mail as 'read', 'unread', 'flagged' or 'unflagged'
	 *
	 * @param _action _action.id is 'read', 'unread', 'flagged' or 'unflagged'
	 * @param _elems
	 * @param _allMessagesChecked
	 */
	mail_callFlagMessages: function(_action, _elems, _allMessagesChecked)
	{
		var do_nmactions = true;
		var msg;
		var ftree;
		var _folder;
		if (typeof _allMessagesChecked=='undefined') _allMessagesChecked=false;
		if (_action.id=='read')
		{
			ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
			var _foldernode = ftree.getSelectedNode();
			_folder = _foldernode.id;
		}
		if (typeof _elems == 'undefined'|| _elems.length==0)
		{
			do_nmactions = false;//indicates that this action is probably a popup?
			if (this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				msg = {};
				msg['msg'] = [this.et2.getArrayMgr('content').getEntry('mail_id') || ''];
			}
			if ((typeof _elems == 'undefined'|| _elems.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					msg = {};
					msg['msg'] = [this.mail_currentlyFocussed];
					_elems = msg;
					do_nmactions = true;// is triggered from preview
				}
			}
		}

		var classToProcess = _action.id;
		if (_action.id=='read') classToProcess='seen';
		else if (_action.id=='readall') classToProcess='seen';
		else if (_action.id=='label1') classToProcess='labelone';
		else if (_action.id=='label2') classToProcess='labeltwo';
		else if (_action.id=='label3') classToProcess='labelthree';
		else if (_action.id=='label4') classToProcess='labelfour';
		else if (_action.id=='label5') classToProcess='labelfive';

		if (do_nmactions)
		{
			msg = this.mail_getFormData(_elems);
			msg['all'] = _allMessagesChecked;
			if (msg['all']=='cancel') return false;
			msg['activeFilters'] = (_action.id=='readall'?false:this.mail_getActiveFilters(_action));
			if (_action.id.substring(0,2)=='un') {
				//old style, only available for undelete and unlabel (no toggle)
				if ( _action.id=='unlabel') // this means all labels should be removed
				{
					var labels = ['labelone','labeltwo','labelthree','labelfour','labelfive'];
					for (var i=0; i<labels.length; i++)	this.mail_removeRowClass(_elems,labels[i]);
					this.mail_flagMessages(_action.id,msg,(do_nmactions?false:true));
				}
				else
				{
					this.mail_removeRowClass(_elems,_action.id.substring(2));
					this.mail_setRowClass(_elems,_action.id);
					this.mail_flagMessages(_action.id,msg,(do_nmactions?false:true));
				}
			}
			else if (_action.id=='readall')
			{
				this.mail_flagMessages('read',msg,(do_nmactions?false:true));
			}
			else
			{
				var msg_set = {msg:[]};
				var msg_unset = {msg:[]};
				var dataElem;
				var flags;
				var classes = '';
				for (var i=0; i<msg.msg.length; i++)
				{
					dataElem = egw.dataGetUIDdata(msg.msg[i]);
					if(typeof dataElem.data.flags == 'undefined')
					{
						dataElem.data.flags = {};
					}
					flags = dataElem.data.flags;
					classes = dataElem.data['class'] || "";
					classes = classes.split(' ');
					// since we toggle we need to unset the ones already set, and set the ones not set
					// flags is data, UI is done by class, so update both
					// Flags are there or not, class names are flag or 'un'+flag
					if(classes.indexOf(classToProcess) >= 0)
					{
						classes.splice(classes.indexOf(classToProcess),1);
					}
					if(classes.indexOf('un' + classToProcess) >= 0)
					{
						classes.splice(classes.indexOf('un' + classToProcess),1);
					}
					if (flags[_action.id])
					{
						msg_unset['msg'].push(msg.msg[i]);
						classes.push('un'+classToProcess);
						delete flags[_action.id];
					}
					else
					{
						msg_set['msg'].push(msg.msg[i]);
						flags[_action.id] = _action.id;
						classes.push(classToProcess);
					}

					// Update cache & call callbacks - updates list
					dataElem.data['class']  = classes.join(' ');
					egw.dataStoreUID(msg.msg[i],dataElem.data);

					//Refresh the nm rows after we told dataComponent about all changes, since the dataComponent doesn't talk to nm, we need to do it manually
					this.updateFilter_data(msg.msg[i], _action.id, msg.activeFilters);
				}

				// Notify server of changes
				if (msg_unset['msg'] && msg_unset['msg'].length)
				{
					if (!msg['all']) this.mail_flagMessages('un'+_action.id,msg_unset);
				}
				if (msg_set['msg'] && msg_set['msg'].length)
				{
					if (!msg['all']) this.mail_flagMessages(_action.id,msg_set);
				}
				//server must do the toggle, as we apply to ALL, not only the visible
				if (msg['all']) this.mail_flagMessages(_action.id,msg);
				// No further update needed, only in case of read, the counters should be refreshed
				if (_action.id=='read') this.mail_refreshFolderStatus(_folder,'thisfolderonly',false,true);
				return;
			}
		}
		else
		{
			this.mail_flagMessages(_action.id,msg,(do_nmactions?false:true));
		}
		// only refresh counter. not grid as the ajaxmethod is called asyncronously
		// on flagging, only seen/unseen has effect on counterdisplay
		if (_action.id=='read' || _action.id=='readall') this.mail_refreshFolderStatus(_folder,'thisfolderonly',false,true);
		//this.mail_refreshFolderStatus();
	},

	/**
	 * Update changes on filtered mail rows in nm, triggers manual refresh
	 *
	 * @param {type} _uid mail uid
	 * @param {type} _actionId action id sended by nm action
	 * @param {type} _filters activefilters
	 */
	updateFilter_data: function (_uid, _actionId, _filters)
	{
		var uid = _uid.replace('mail::','');
		var action = '';
		switch (_actionId)
		{
			case 'flagged':
				action = 'flagged';
				break;
			case 'read':
				if (_filters.filter == 'seen')
				{
					action = 'seen';
				}
				else if (_filters.filter == 'unseen')
				{
					action = 'unseen';
				}
				break;
			case 'label1':
				action = 'keyword1';
				break;
			case 'label2':
				action = 'keyword2';
				break;
			case 'label3':
				action = 'keyword3';
				break;
			case 'label4':
				action = 'keyword4';
				break;
			case 'label4':
				action = 'keyword4';
				break;
		}
		if (action == _filters.filter)
		{
			egw.refresh('','mail',uid, 'delete');
		}
	},

	/**
	 * Flag mail as 'read', 'unread', 'flagged' or 'unflagged'
	 *
	 * @param {object} _flag
	 * @param {object} _elems
	 * @param {boolean} _isPopup
	 */
	mail_flagMessages: function(_flag, _elems,_isPopup)
	{
		egw.jsonq('mail.mail_ui.ajax_flagMessages',[_flag, _elems]);
		//	.sendRequest(true);
	},

	/**
	 * display header lines, or source of mail, depending on the url given
	 *
	 * @param _url
	 */
	mail_displayHeaderLines: function(_url) {
		// only used by right clickaction
		egw_openWindowCentered(_url,'mail_display_headerLines','870','600',window.outerWidth/2,window.outerHeight/2);
	},

	/**
	 * View header of a message
	 *
	 * @param _action
	 * @param _elems _elems[0].id is the row-id
	 */
	mail_header: function(_action, _elems)
	{
		if (typeof _elems == 'undefined'|| _elems.length==0)
		{
			if (this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				var _elems = [];
				_elems.push({id:this.et2.getArrayMgr("content").getEntry('mail_id') || ''});
			}
			if ((typeof _elems == 'undefined' || _elems.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					var _elems = [];
					_elems.push({id:this.mail_currentlyFocussed});
				}
			}
		}
		//alert('mail_header('+_elems[0].id+')');
		var url = window.egw_webserverUrl+'/index.php?';
		url += 'menuaction=mail.mail_ui.displayHeader';	// todo compose for Draft folder
		url += '&id='+_elems[0].id;
		this.mail_displayHeaderLines(url);
	},

	/**
	 * View message source
	 *
	 * @param _action
	 * @param _elems _elems[0].id is the row-id
	 */
	mail_mailsource: function(_action, _elems)
	{
		if (typeof _elems == 'undefined' || _elems.length==0)
		{
			if (this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				var _elems = [];
				_elems.push({id:this.et2.getArrayMgr("content").getEntry('mail_id') || ''});
			}
			if ((typeof _elems == 'undefined'|| _elems.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					var _elems = [];
					_elems.push({id:this.mail_currentlyFocussed});
				}
			}
		}
		//alert('mail_mailsource('+_elems[0].id+')');
		var url = window.egw_webserverUrl+'/index.php?';
		url += 'menuaction=mail.mail_ui.saveMessage';	// todo compose for Draft folder
		url += '&id='+_elems[0].id;
		url += '&location=display';
		this.mail_displayHeaderLines(url);
	},

	/**
	 * Save a message
	 *
	 * @param _action
	 * @param _elems _elems[0].id is the row-id
	 */
	mail_save: function(_action, _elems)
	{
		if (typeof _elems == 'undefined' || _elems.length==0)
		{
			if (this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				var _elems = [];
				_elems.push({id:this.et2.getArrayMgr("content").getEntry('mail_id') || ''});
			}
			if ((typeof _elems == 'undefined' || _elems.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					var _elems = [];
					_elems.push({id:this.mail_currentlyFocussed});
				}
			}
		}
		//alert('mail_save('+_elems[0].id+')');
		var url = window.egw_webserverUrl+'/index.php?';
		url += 'menuaction=mail.mail_ui.saveMessage';	// todo compose for Draft folder
		url += '&id='+_elems[0].id;
		//window.open(url,'_blank','dependent=yes,width=100,height=100,scrollbars=yes,status=yes');
		this.et2._inst.download(url);
	},

	/**
	 * User clicked an address (FROM, TO, etc)
	 *
	 * @param {object} tag_info with values for attributes id, label, title, ...
	 * @param {widget object} widget
	 *
	 * @todo seems this function is not implemented, need to be checked if it is neccessary at all
	 */
	address_click: function(tag_info, widget)
	{

	},

	/**
	 * displayAttachment
	 *
	 * @param {object} tag_info
	 * @param {widget object} widget
	 * @param {object} calledForCompose
	 */
	displayAttachment: function(tag_info, widget, calledForCompose)
	{
		var mailid;
		var attgrid;
		if (typeof calledForCompose == 'undefined' || typeof calledForCompose == 'object') calledForCompose=false;
		if (calledForCompose===false)
		{
			if (this.mail_isMainWindow)
			{
				mailid = this.mail_currentlyFocussed;//this.et2.getArrayMgr("content").getEntry('mail_id');
				var p = widget.getParent();
				var cont = p.getArrayMgr("content").data;
				attgrid = cont[widget.id.replace(/\[filename\]/,'')];
			}
			else
			{
				mailid = this.et2.getArrayMgr("content").getEntry('mail_id');
				attgrid = this.et2.getArrayMgr("content").getEntry('mail_displayattachments')[widget.id.replace(/\[filename\]/,'')];
			}
		}
		if (calledForCompose===true)
		{
			// CALLED FOR COMPOSE; processedmail_id could hold several IDs seperated by comma
			attgrid = this.et2.getArrayMgr("content").getEntry('attachments')[widget.id.replace(/\[name\]/,'')];
			var mailids = this.et2.getArrayMgr("content").getEntry('processedmail_id');
			var mailida = mailids.split(',');
			// either several attachments of one email, or multiple emlfiles
			mailid = mailida.length==1 ? mailida[0] : mailida[widget.id.replace(/\[name\]/,'')];
			if (typeof attgrid.uid != 'undefined' && attgrid.uid && mailid.indexOf(attgrid.uid)==-1)
			{
				for (var i=0; i<mailida.length; i++)
				{
					if (mailida[i].indexOf('::'+attgrid.uid)>-1) mailid = mailida[i];
				}
			}
		}
		var url = window.egw_webserverUrl+'/index.php?';
		var width;
		var height;
		var windowName ='mail';
		switch(attgrid.type.toUpperCase())
		{
			case 'MESSAGE/RFC822':
				url += 'menuaction=mail.mail_ui.displayMessage';	// todo compose for Draft folder
				url += '&mode=display';//message/rfc822 attachments should be opened in display mode
				url += '&id='+mailid;
				url += '&part='+attgrid.partID;
				url += '&is_winmail='+attgrid.winmailFlag;
				windowName = windowName+'displayMessage_'+mailid+'_'+attgrid.partID;
				width = 870;
				height = egw_getWindowOuterHeight();
				break;
			case 'IMAGE/JPEG':
			case 'IMAGE/PNG':
			case 'IMAGE/GIF':
			case 'IMAGE/BMP':
			case 'APPLICATION/PDF':
			case 'TEXT/PLAIN':
			case 'TEXT/HTML':
			case 'TEXT/DIRECTORY':
/*
				$sfxMimeType = $value['mimeType'];
				$buff = explode('.',$value['name']);
				$suffix = '';
				if (is_array($buff)) $suffix = array_pop($buff); // take the last extension to check with ext2mime
				if (!empty($suffix)) $sfxMimeType = mime_magic::ext2mime($suffix);
				if (strtoupper($sfxMimeType) == 'TEXT/VCARD' || strtoupper($sfxMimeType) == 'TEXT/X-VCARD')
				{
					$attachments[$key]['mimeType'] = $sfxMimeType;
					$value['mimeType'] = strtoupper($sfxMimeType);
				}
*/
			case 'TEXT/X-VCARD':
			case 'TEXT/VCARD':
			case 'TEXT/CALENDAR':
			case 'TEXT/X-VCALENDAR':
				url += 'menuaction=mail.mail_ui.getAttachment';	// todo compose for Draft folder
				url += '&id='+mailid;
				url += '&part='+attgrid.partID;
				url += '&is_winmail='+attgrid.winmailFlag;
				windowName = windowName+'displayAttachment_'+mailid+'_'+attgrid.partID;
				var reg = '800x600';
				var reg2;
				// handle calendar/vcard
				if (attgrid.type.toUpperCase()=='TEXT/CALENDAR')
				{
					windowName = 'maildisplayEvent_'+mailid+'_'+attgrid.partID;
					reg2 = egw.link_get_registry('calendar');
					if (typeof reg2['view'] != 'undefined' && typeof reg2['view_popup'] != 'undefined' )
					{
						reg = reg2['view_popup'];
					}
				}
				if (attgrid.type.toUpperCase()=='TEXT/X-VCARD' || attgrid.type.toUpperCase()=='TEXT/VCARD')
				{
					windowName = 'maildisplayContact_'+mailid+'_'+attgrid.partID;
					reg2 = egw.link_get_registry('addressbook');
					if (typeof reg2['add'] != 'undefined' && typeof reg2['add_popup'] != 'undefined' )
					{
						reg = reg2['add_popup'];
					}
				}
				var w_h =reg.split('x');
				width = w_h[0];
				height = w_h[1];
				break;
			default:
				url += 'menuaction=mail.mail_ui.getAttachment';	// todo compose for Draft folder
				url += '&id='+mailid;
				url += '&part='+attgrid.partID;
				url += '&is_winmail='+attgrid.winmailFlag;
				windowName = windowName+'displayAttachment_'+mailid+'_'+attgrid.partID;
				width = 870;
				height = 600;
				break;
		}
		egw_openWindowCentered(url,windowName,width,height);
	},

	/**
	 * displayUploadedFile
	 *
	 * @param {object} tag_info
	 * @param {widget object} widget
	 */
	displayUploadedFile: function(tag_info, widget)
	{
		var attgrid;
		attgrid = this.et2.getArrayMgr("content").getEntry('attachments')[widget.id.replace(/\[name\]/,'')];

		if (attgrid.uid && (attgrid.partID||attgrid.folder))
		{
			this.displayAttachment(tag_info, widget, true);
			return;
		}
		var get_param = {
			menuaction: 'mail.mail_compose.getAttachment',	// todo compose for Draft folder
			tmpname: attgrid.tmp_name,
			etemplate_exec_id: this.et2._inst.etemplate_exec_id
		};
		var width;
		var height;
		var windowName ='maildisplayAttachment_'+attgrid.file.replace(/\//g,"_");
		switch(attgrid.type.toUpperCase())
		{
			case 'IMAGE/JPEG':
			case 'IMAGE/PNG':
			case 'IMAGE/GIF':
			case 'IMAGE/BMP':
			case 'APPLICATION/PDF':
			case 'TEXT/PLAIN':
			case 'TEXT/HTML':
			case 'TEXT/DIRECTORY':
			case 'TEXT/X-VCARD':
			case 'TEXT/VCARD':
			case 'TEXT/CALENDAR':
			case 'TEXT/X-VCALENDAR':
				var reg = '800x600';
				var reg2;
				// handle calendar/vcard
				if (attgrid.type.toUpperCase()=='TEXT/CALENDAR')
				{
					windowName = 'maildisplayEvent_'+attgrid.file.replace(/\//g,"_");
					reg2 = egw.link_get_registry('calendar');
					if (typeof reg2['view'] != 'undefined' && typeof reg2['view_popup'] != 'undefined' )
					{
						reg = reg2['view_popup'];
					}
				}
				if (attgrid.type.toUpperCase()=='TEXT/X-VCARD' || attgrid.type.toUpperCase()=='TEXT/VCARD')
				{
					windowName = 'maildisplayContact_'+attgrid.file.replace(/\//g,"_");
					reg2 = egw.link_get_registry('addressbook');
					if (typeof reg2['add'] != 'undefined' && typeof reg2['add_popup'] != 'undefined' )
					{
						reg = reg2['add_popup'];
					}
				}
				var w_h =reg.split('x');
				width = w_h[0];
				height = w_h[1];
				break;
			case 'MESSAGE/RFC822':
			default:
				get_param.mode = 'save';
				width = 870;
				height = 600;
				break;
		}
		egw.openPopup(egw.link('/index.php', get_param), width, height, windowName);
	},

	saveAttachment: function(tag_info, widget)
	{
		var mailid;
		var attgrid;
		if (this.mail_isMainWindow)
		{
			mailid = this.mail_currentlyFocussed;//this.et2.getArrayMgr("content").getEntry('mail_id');
			var p = widget.getParent();
			var cont = p.getArrayMgr("content").data;
			attgrid = cont[widget.id.replace(/\[save\]/,'')];
		}
		else
		{
			mailid = this.et2.getArrayMgr("content").getEntry('mail_id');
			attgrid = this.et2.getArrayMgr("content").getEntry('mail_displayattachments')[widget.id.replace(/\[save\]/,'')];
		}
		var url = window.egw_webserverUrl+'/index.php?';
		url += 'menuaction=mail.mail_ui.getAttachment';	// todo compose for Draft folder
		url += '&mode=save';
		url += '&id='+mailid;
		url += '&part='+attgrid.partID;
		url += '&is_winmail='+attgrid.winmailFlag;
		this.et2._inst.download(url);
	},

	saveAllAttachmentsToZip: function(tag_info, widget)
	{
		var mailid;
		var attgrid;
		if (this.mail_isMainWindow)
		{
			mailid = this.mail_currentlyFocussed;//this.et2.getArrayMgr("content").getEntry('mail_id');
			var p = widget.getParent();
			var cont = p.getArrayMgr("content").data;
			attgrid = cont[widget.id.replace(/\[save\]/,'')];
		}
		else
		{
			mailid = this.et2.getArrayMgr("content").getEntry('mail_id');
			attgrid = this.et2.getArrayMgr("content").getEntry('mail_displayattachments')[widget.id.replace(/\[save\]/,'')];
		}
		var url = window.egw_webserverUrl+'/index.php?';
		url += 'menuaction=mail.mail_ui.download_zip';	// todo compose for Draft folder
		url += '&mode=save';
		url += '&id='+mailid;
		this.et2._inst.download(url);
	},

	saveAttachmentToVFS: function(tag_info, widget)
	{
		var mailid;
		var attgrid;
		if (this.mail_isMainWindow)
		{
			mailid = this.mail_currentlyFocussed;//this.et2.getArrayMgr("content").getEntry('mail_id');
			var p = widget.getParent();
			var cont = p.getArrayMgr("content").data;
			attgrid = cont[widget.id.replace(/\[saveAsVFS\]/,'')];
		}
		else
		{
			mailid = this.et2.getArrayMgr("content").getEntry('mail_id');
			attgrid = this.et2.getArrayMgr("content").getEntry('mail_displayattachments')[widget.id.replace(/\[saveAsVFS\]/,'')];
		}
		var url = window.egw_webserverUrl+'/index.php?';
		var width=640;
		var height=570;
		var windowName ='mail';
		url += 'menuaction=filemanager.filemanager_select.select';	// todo compose for Draft folder
		url += '&mode=saveas';
		url += '&id='+mailid+'::'+attgrid.partID+'::'+attgrid.winmailFlag;
		url += '&name='+attgrid.filename;
		url += '&type='+attgrid.type.toLowerCase();
		url += '&method=mail.mail_ui.vfsSaveAttachment';
		url += '&label='+egw.lang('Save');
		egw_openWindowCentered(url,windowName,width,height);
	},

	saveAllAttachmentsToVFS: function(tag_info, widget)
	{
		var mailid;
		var attgrid;
		if (this.mail_isMainWindow)
		{
			mailid = this.mail_currentlyFocussed;//this.et2.getArrayMgr("content").getEntry('mail_id');
			var p = widget.getParent();
			attgrid = p.getArrayMgr("content").data;
		}
		else
		{
			mailid = this.et2.getArrayMgr("content").getEntry('mail_id');
			attgrid = this.et2.getArrayMgr("content").getEntry('mail_displayattachments');
		}
		var url = window.egw_webserverUrl+'/index.php?';
		var width=640;
		var height=570;
		var windowName ='mail';
		url += 'menuaction=filemanager.filemanager_select.select';	// todo compose for Draft folder
		url += '&mode=select-dir';
		url += '&method=mail.mail_ui.vfsSaveAttachment';
		url += '&label='+egw.lang('Save all');
		for (var i=0;i<attgrid.length;i++)
		{
			if (attgrid[i] != null) url += '&id['+i+']='+mailid+'::'+attgrid[i].partID+'::'+attgrid[i].winmailFlag+'::'+attgrid[i].filename;
		}
		egw_openWindowCentered(url,windowName,width,height);
	},

	/**
	 * Save a message to filemanager
	 *
	 * @param _action
	 * @param _elems _elems[0].id is the row-id
	 */
	mail_save2fm: function(_action, _elems)
	{
		if (typeof _elems == 'undefined' || _elems.length==0)
		{
			if (this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				var _elems = [];
				_elems.push({id:this.et2.getArrayMgr("content").getEntry('mail_id') || ''});
			}
			if ((typeof _elems == 'undefined' || _elems.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					var _elems = [];
					_elems.push({id:this.mail_currentlyFocussed});
				}
			}
		}
		var _id = _elems[0].id;
		var dataElem = egw.dataGetUIDdata(_id);
		var url = window.egw_webserverUrl+'/index.php?';
		url += 'menuaction=filemanager.filemanager_select.select';	// todo compose for Draft folder
		url += '&mode=saveas';
		var subject = dataElem? dataElem.data.subject: _elems[0].subject;
		var filename = subject.replace(/[\f\n\t\v]/g,"_")|| 'unknown';
		url += '&name='+encodeURIComponent(filename+'.eml');
		url += '&mime=message'+encodeURIComponent('/')+'rfc822';
		url += '&method=mail.mail_ui.vfsSaveMessage';
		url += '&id='+_elems[0].id;
		url += '&label=Save';
		egw_openWindowCentered(url,'vfs_save_message_'+_elems[0].id,'680','400',window.outerWidth/2,window.outerHeight/2);

	},

	/**
	 * Integrate mail message into another app's entry
	 *
	 * @param _action
	 * @param _elems _elems[0].id is the row-id
	 */
	mail_integrate: function(_action, _elems)
	{
		var app = _action.id;
		var w_h = ['750','580']; // define a default wxh if there's no popup size registered

		var add_as_new = true;

		if (typeof _action.data != 'undefined' )
		{
			if (typeof _action.data.popup != 'undefined' && _action.data.popup) w_h = _action.data.popup.split('x');
			if (typeof _action.data.mail_import != 'undefined') var mail_import_hook = _action.data.mail_import;
		}

		if (typeof _elems == 'undefined' || _elems.length==0)
		{
			if (this.et2.getArrayMgr("content").getEntry('mail_id'))
			{
				var _elems = [];
				_elems.push({id:this.et2.getArrayMgr("content").getEntry('mail_id') || ''});
			}
			if ((typeof _elems == 'undefined' || _elems.length==0) && this.mail_isMainWindow)
			{
				if (this.mail_currentlyFocussed)
				{
					var _elems = [];
					_elems.push({id:this.mail_currentlyFocussed});
				}
			}
		}

		var url = window.egw_webserverUrl+ '/index.php?menuaction=mail.mail_integration.integrate&rowid=' + _elems[0].id + '&app='+app;

		/**
		 * Checks the application entry existance and offers user
		 * to select desire app id to append mail content into it,
		 * or add the mail content as a new app entry
		 *
		 * @param {string} _title select app entry title
		 * @param {string} _appName app to be integrated
		 * @param {string} _appCheckCallback registered mail_import hook method
		 *	for check app entry existance
		 */
		check_app_entry = function (_title, _appName, _appCheckCallback)
		{
			var data = egw.dataGetUIDdata(_elems[0].id);
			var subject = (data && typeof data.data != 'undefined')? data.data.subject : '';
			egw.json(_appCheckCallback, subject,function(_entryId){

				// if there's no entry saved already
				// open dialog in order to select one
				if (!_entryId)
				{
					var buttons = [
						{text: 'Append', id: 'append', image: 'check', default:true},
						{text: 'Add as new', id: 'new', image: 'check'},
						{text: 'Cancel', id: 'cancel', image: 'check'}
					];
					et2_createWidget("dialog",
					{
						callback: function(_buttons, _value)
						{
							if (_buttons == 'cancel') return;
							if (_buttons == 'append' && _value)
							{
								url += '&entry_id=' + _value.id;
							}
							egw_openWindowCentered(url,'import_mail_'+_elems[0].id,w_h[0],w_h[1]);
						},
						title: egw.lang(_title),
						buttons: buttons||et2_dialog.BUTTONS_OK_CANCEL,
						value:{
							content:{
								appName:_appName // appName to search on its list later
						}},
						template: egw.webserverUrl+'/mail/templates/default/integration_to_entry_dialog.xet'
					},et2_dialog._create_parent('mail'));
				}
				else // there is an entry saved related to this mail's subject
				{
					egw_openWindowCentered(url,'import_mail_'+_elems[0].id,w_h[0],w_h[1]);
				}
			},this,true,this).sendRequest();
		};

		if (mail_import_hook && typeof mail_import_hook.app_entry_method != 'undefined')
		{
			check_app_entry('Select '+ app + ' entry', app,  mail_import_hook.app_entry_method);
		}
		else
		{
			egw_openWindowCentered(url,'import_mail_'+_elems[0].id,w_h[0],w_h[1]);
		}

	},

	/**
	 * mail_getFormData
	 *
	 * @param {object} _actionObjects the senders
	 *
	 * @return structured array of message ids: array(msg=>message-ids)
	 */
	mail_getFormData: function(_actionObjects) {
		var messages = {};
		// if
		if (typeof _actionObjects['msg'] != 'undefined' && _actionObjects['msg'].length>0) return _actionObjects;
		if (_actionObjects.length>0)
		{
			messages['msg'] = [];
		}

		for (var i = 0; i < _actionObjects.length; i++)
		{
			if (_actionObjects[i].id.length>0)
			{
				messages['msg'][i] = _actionObjects[i].id;
			}
		}

		return messages;
	},

	/**
	 * mail_setRowClass
	 *
	 * @param {object} _actionObjects the senders
	 * @param {string} _class
	 */
	mail_setRowClass: function(_actionObjects,_class) {
		if (typeof _class == 'undefined') return false;

		if (typeof _actionObjects['msg'] == 'undefined')
		{
			for (var i = 0; i < _actionObjects.length; i++)
			{
				// Check that the ID & interface is there.  Paste is missing iface.
				if (_actionObjects[i].id.length>0 && _actionObjects[i].iface)
				{
					var dataElem = $j(_actionObjects[i].iface.getDOMNode());
					dataElem.addClass(_class);

				}
			}
		}
		else
		{
			for (var i = 0; i < _actionObjects['msg'].length; i++)
			{
				var mail_uid = _actionObjects['msg'][i];

				// Get the record from data cache
				var dataElem = egw.dataGetUIDdata(mail_uid);
				if(dataElem == null || typeof dataElem == undefined)
				{
					// Unknown ID, nothing to update
					return;
				}

				// Update class
				dataElem.data['class']  += ' ' + _class;

				// need to update flags too
				switch(_class)
				{
					case 'unseen':
						delete dataElem.data.flags.read;
						break;
				}

				// Update record, which updates all listeners (including nextmatch)
				egw.dataStoreUID(mail_uid,dataElem.data);
			}
		}
	},

	/**
	 * mail_removeRowFlag
	 * Removes a flag and updates the CSS class.  Updates the UI, but not the server.
	 *
	 * @param {action object} _actionObjects the senders, or a messages object
	 * @param {string} _class the class to be removed
	 */
	mail_removeRowClass: function(_actionObjects,_class) {
		if (typeof _class == 'undefined') return false;

		if (typeof _actionObjects['msg'] == 'undefined')
		{
			for (var i = 0; i < _actionObjects.length; i++)
			{
				if (_actionObjects[i].id.length>0)
				{
					var dataElem = $j(_actionObjects[i].iface.getDOMNode());
					dataElem.removeClass(_class);

				}
			}
		}
		else
		{
			for (var i = 0; i < _actionObjects['msg'].length; i++)
			{
				var mail_uid = _actionObjects['msg'][i];

				// Get the record from data cache
				var dataElem = egw.dataGetUIDdata(mail_uid);
				if(dataElem == null || typeof dataElem == undefined)
				{
					// Unknown ID, nothing to update
					return;
				}

				// Update class
				var classes = dataElem.data['class'] || "";
				classes = classes.split(' ');
				if(classes.indexOf(_class) >= 0)
				{
					classes.splice(classes.indexOf(_class),1);
					dataElem.data['class'] = classes.join(' ');

					// need to update flags too
					switch(_class)
					{
						case 'unseen':
							dataElem.data.flags.read = true;
							break;
					}

					// Update record, which updates all listeners (including nextmatch)
					egw.dataStoreUID(mail_uid,dataElem.data);
				}
			}
		}
	},

	/**
	 * mail_move2folder - implementation of the move action from action menu
	 *
	 * @param _action _action.id holds folder target information
	 * @param _elems - the representation of the elements to be affected
	 */
	mail_move2folder: function(_action, _elems) {
		this.mail_move(_action, _elems, null);
	},

	/**
	 * mail_move - implementation of the move action from drag n drop
	 *
	 * @param _action
	 * @param _senders - the representation of the elements dragged
	 * @param _target - the representation of the target
	 */
	mail_move: function(_action,_senders,_target) {
		this.mail_checkAllSelected(_action,_senders,_target,true);
	},

	/**
	 * mail_move - implementation of the move action from drag n drop
	 *
	 * @param _action
	 * @param _senders - the representation of the elements dragged
	 * @param _target - the representation of the target
	 * @param _allMessagesChecked
	 */
	mail_callMove: function(_action,_senders,_target,_allMessagesChecked) {
		var target = _action.id == 'drop_move_mail' ? _target.iface.id : _action.id.substr(5);
		var messages = this.mail_getFormData(_senders);
		if (typeof _allMessagesChecked=='undefined') _allMessagesChecked=false;

		// Directly delete any cache for target
		if(window.localStorage)
		{
			for(var i = 0; i < window.localStorage.length; i++)
			{
				var key = window.localStorage.key(i);

				// Find directly by what the key would look like
				if(key.indexOf('cached_fetch_mail::{"selectedFolder":"'+target+'"') == 0)
				{
					window.localStorage.removeItem(key);
				}
			}
		}
		// TODO: Write move/copy function which cares about doing the same stuff
		// as the "onNodeSelect" function!
		messages['all'] = _allMessagesChecked;
		if (messages['all']=='cancel') return false;
		if (messages['all']) messages['activeFilters'] = this.mail_getActiveFilters(_action);

		// Make sure a default target folder is set in case of drop target is parent 0 (mail account name)
		if (!target.match(/::/g)) target += '::INBOX';

		var self = this;
		var nm = this.et2.getWidgetById(this.nm_index);
		egw.json('mail.mail_ui.ajax_copyMessages',[target, messages, 'move'], function(){
			self.unlock_tree();
			// Nextmatch automatically selects the next row and calls preview.
			// Unselect it and thanks to the timeout selectionMgr uses, preview
			// will close when the selection callback fires instead of load the
			// next message
			nm.controller._selectionMgr.resetSelection();

			// Server response may contain refresh, but it's always delete
			// Refresh list if current view is the target (happens when pasting)
			var tree = self.et2.getWidgetById('nm[foldertree]');
			if(nm && tree && target == tree.getValue())
			{
				// Can't trust the sorting, needs to be full refresh
				nm.refresh();
			}
		})
			.sendRequest();
		this.mail_setRowClass(_senders,'deleted');
		// Server response may contain refresh, not needed here
	},

	/**
	 * mail_copy - implementation of the move action from drag n drop
	 *
	 * @param _action
	 * @param _senders - the representation of the elements dragged
	 * @param _target - the representation of the target
	 */
	mail_copy: function(_action,_senders,_target) {
		this.mail_checkAllSelected(_action,_senders,_target,true);
	},

	/**
	 * mail_callCopy - implementation of the copy action from drag n drop
	 *
	 * @param _action
	 * @param _senders - the representation of the elements dragged
	 * @param _target - the representation of the target
	 * @param _allMessagesChecked
	 */
	mail_callCopy: function(_action,_senders,_target,_allMessagesChecked) {
		var target = _action.id == 'drop_copy_mail' ? _target.iface.id : _action.id.substr(5);
		var messages = this.mail_getFormData(_senders);
		if (typeof _allMessagesChecked=='undefined') _allMessagesChecked=false;
		// TODO: Write move/copy function which cares about doing the same stuff
		// as the "onNodeSelect" function!
		messages['all'] = _allMessagesChecked;
		if (messages['all']=='cancel') return false;
		if (messages['all']) messages['activeFilters'] = this.mail_getActiveFilters(_action);
		var self = this;
		egw.json('mail.mail_ui.ajax_copyMessages',[target, messages],function (){self.unlock_tree();})
			.sendRequest();
		// Server response contains refresh
	},

	/**
	 * mail_AddFolder - implementation of the AddFolder action of right click options on the tree
	 *
	 * @param _action
	 * @param _senders - the representation of the tree leaf to be manipulated
	 */
	mail_AddFolder: function(_action,_senders) {
		//action.id == 'add'
		//_senders.iface.id == target leaf / leaf to edit
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var OldFolderName = ftree.getLabel(_senders[0].id).replace(this._unseen_regexp,'');
		var buttons = [
			{text: this.egw.lang("Add"), id: "add", "class": "ui-priority-primary", "default": true},
			{text: this.egw.lang("Cancel"), id:"cancel"}
		];
		et2_dialog.show_prompt(function(_button_id, _value) {
			var NewFolderName = null;
			if (_value.length>0) NewFolderName = _value;
			//alert(NewFolderName);
			if (NewFolderName && NewFolderName.length>0)
			{
				switch (_button_id)
				{
					case "add":
						egw.json('mail.mail_ui.ajax_addFolder',[_senders[0].id, NewFolderName])
							.sendRequest(true);
						return;
					case "cancel":
				}
			}
		},
		this.egw.lang("Enter the name for the new Folder:"),
		this.egw.lang("Add a new Folder to %1:",OldFolderName),
		'', buttons);
	},

	/**
	 * mail_RenameFolder - implementation of the RenameFolder action of right click options on the tree
	 *
	 * @param _action
	 * @param _senders - the representation of the tree leaf to be manipulated
	 */
	mail_RenameFolder: function(_action,_senders) {
		//action.id == 'rename'
		//_senders.iface.id == target leaf / leaf to edit
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var OldFolderName = ftree.getLabel(_senders[0].id).replace(this._unseen_regexp,'');
		var buttons = [
			{text: this.egw.lang("Rename"), id: "rename", "class": "ui-priority-primary", image: 'edit', "default": true},
			{text: this.egw.lang("Cancel"), id:"cancel"}
		];
		et2_dialog.show_prompt(function(_button_id, _value) {
			var NewFolderName = null;
			if (_value.length>0) NewFolderName = _value;
			//alert(NewFolderName);
			if (NewFolderName && NewFolderName.length>0)
			{
				switch (_button_id)
				{
					case "rename":
						egw.json('mail.mail_ui.ajax_renameFolder',[_senders[0].id, NewFolderName])
							.sendRequest(true);
						return;
					case "cancel":
				}
			}
		},
		this.egw.lang("Rename Folder %1 to:",OldFolderName),
		this.egw.lang("Rename Folder %1 ?",OldFolderName),
		OldFolderName, buttons);
	},

	/**
	 * mail_MoveFolder - implementation of the MoveFolder action on the tree
	 *
	 * @param {egwAction} _action
	 * @param {egwActionObject[]} _senders - the representation of the tree leaf to be manipulated
	 * @param {egwActionObject} destination Drop target egwActionObject representing the destination
	 */
	mail_MoveFolder: function(_action,_senders,destination) {
		if(!destination || !destination.id)
		{
			egw.debug('warn', "Move folder, but no target");
			return;
		}
		// Some UI feedback while the folder is moved - using just the iface DOMNode would
		// put the load image in every row
		var load_node = $j(destination.iface.getDOMNode()).closest('td').prev()
			.addClass('loading');

		for(var i = 0; i < _senders.length; i++)
		{
			egw.jsonq('mail.mail_ui.ajax_MoveFolder',[_senders[i].id, destination.id],
				// Move is done (successfully or not), remove loading
				function() {load_node.removeClass('loading');}
			);
		}
	},

	/**
	 * mail_DeleteFolder - implementation of the DeleteFolder action of right click options on the tree
	 *
	 * @param _action
	 * @param _senders - the representation of the tree leaf to be manipulated
	 */
	mail_DeleteFolder: function(_action,_senders) {
		//action.id == 'delete'
		//_senders.iface.id == target leaf / leaf to edit
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		var OldFolderName = ftree.getLabel(_senders[0].id).replace(this._unseen_regexp,'');
		var buttons = [
			{text: this.egw.lang("Yes"), id: "delete", "class": "ui-priority-primary", "default": true},
			{text: this.egw.lang("Cancel"), id:"cancel"}
		];
		et2_dialog.show_dialog(function(_button_id, _value) {
			switch (_button_id)
			{
				case "delete":
					egw.json('mail.mail_ui.ajax_deleteFolder',[_senders[0].id])
						.sendRequest(true);
					return;
				case "cancel":
			}
		},
		this.egw.lang("Do you really want to DELETE Folder %1 ?",OldFolderName)+" "+(ftree.hasChildren(_senders[0].id)?this.egw.lang("All subfolders will be deleted too, and all messages in all affected folders will be lost"):this.egw.lang("All messages in the folder will be lost")),
		this.egw.lang("DELETE Folder %1 ?",OldFolderName),
		OldFolderName, buttons);
	},

	/**
	 * Send names of uploaded files (again) to server, to process them: either copy to vfs or ask overwrite/rename
	 *
	 * @param _event
	 * @param _file_count
	 * @param {string?} _path where the file is uploaded to, default current directory
	 */
	uploadForImport: function(_event, _file_count, _path)
	{
		// path is probably not needed when uploading for file; maybe it is when from vfs
		if(typeof _path == 'undefined')
		{
			//_path = this.get_path();
		}
		if (_file_count && !jQuery.isEmptyObject(_event.data.getValue()))
		{
			var widget = _event.data;
//			var request = new egw_json_request('mail_ui::ajax_importMessage', ['upload', widget.getValue(), _path], this);
//			widget.set_value('');
//			request.sendRequest();//false, this._upload_callback, this);
			this.et2_obj.submit();
		}
	},

	/**
	 * Send names of uploaded files (again) to server, to process them: either copy to vfs or ask overwrite/rename
	 *
	 * @param {event object} _event
	 * @param {string} _file_count
	 * @param {string} _path [_path=current directory] Where the file is uploaded to.
	 */
	uploadForCompose: function(_event, _file_count, _path)
	{
		// path is probably not needed when uploading for file; maybe it is when from vfs
		if(typeof _path == 'undefined')
		{
			//_path = this.get_path();
		}
		if (_file_count && !jQuery.isEmptyObject(_event.data.getValue()))
		{
			var widget = _event.data;
			this.et2_obj.submit();
		}
	},

	/**
	 * Visible attachment box in compose dialog as soon as the file starts to upload
	 */
	composeUploadStart: function ()
	{
		var boxAttachment = this.et2.getWidgetById('attachments');
		if (boxAttachment)
		{
			var groupbox = boxAttachment.getParent();
			if (groupbox) groupbox.set_disabled(false);
		}
		//Resize the compose dialog
		var self = this;
		setTimeout(function(){self.compose_resizeHandler();}, 100);
		return true;
	},

	/**
	* Upload for import (VFS)
	*
	* @param {egw object} _egw
	* @param {widget object} _widget
	* @param {window object} _window
	*/
	vfsUploadForImport: function(_egw, _widget, _window) {
		if (jQuery.isEmptyObject(_widget)) return;
		if (!jQuery.isEmptyObject(_widget.getValue()))
		{
			this.et2_obj.submit();
		}
	},

	/**
	* Upload for compose (VFS)
	*
	* @param {egw object} _egw
	* @param {widget object} _widget
	* @param {window object} _window
	*/
	vfsUploadForCompose: function(_egw, _widget, _window)
	{
		if (jQuery.isEmptyObject(_widget)) return;
		if (!jQuery.isEmptyObject(_widget.getValue()))
		{
			this.et2_obj.submit();
		}
	},

	/**
	* Submit on change (VFS)
	*
	* @param {egw object} _egw
	* @param {widget object} _widget
	*/
	submitOnChange: function(_egw, _widget)
	{
		if (!jQuery.isEmptyObject(_widget))
		{
			if (typeof _widget.id !== 'undefined') var widgetId = _widget.id;
			switch (widgetId)
			{
				case 'mimeType':
					this.et2_obj.submit();
					break;
				default:
					if (!jQuery.isEmptyObject(_widget.getValue()))
					{
						this.et2_obj.submit();
					}
			}
		}
	},

	/**
	 * Save as Draft (VFS)
	 * -handel both actions save as draft and save as draft and print
	 *
	 * @param {egwAction} _egw_action
	 * @param {array|string} _action string "autosaving", if that triggered the action
	 */
	saveAsDraft: function(_egw_action, _action)
	{
		//this.et2_obj.submit();
		var content = this.et2.getArrayMgr('content').data;
		var action = _action;
		if (_egw_action && _action !== 'autosaving')
		{
			action = _egw_action.id;
		}

		var widgets = ['from','to','cc','bcc','subject','folder','replyto','mailaccount',
			'mail_htmltext', 'mail_plaintext', 'lastDrafted', 'filemode', 'expiration', 'password'];
		var widget = {};
		for (var index in widgets)
		{
			widget = this.et2.getWidgetById(widgets[index]);
			if (widget)
			{
				content[widgets[index]] = widget.get_value();
			}
		}
		var self = this;
		if (content)
		{
			// if we compose an encrypted message, we have to get the encrypted content
			if (this.mailvelope_editor)
			{
				this.mailvelope_editor.encrypt([]).then(function(_armored)
				{
					content['mail_plaintext'] = _armored;
					self.egw.json('mail.mail_compose.ajax_saveAsDraft',[content, action],function(_data){
						self.savingDraft_response(_data,action);
					}).sendRequest(true);
				}, function(_err)
				{
					self.egw.message(_err.message, 'error');
				});
				return false;
			}

			this.egw.json('mail.mail_compose.ajax_saveAsDraft',[content, action],function(_data){
				self.savingDraft_response(_data,action);
			}).sendRequest(true);
		}
	},

	/**
	 * Set content of drafted message with new information sent back from server
	 * This function would be used as callback of send request to ajax_saveAsDraft.
	 *
	 * @param {object} _responseData response data sent back from server by ajax_saveAsDraft function.
	 *  the object conatins below items:
	 *  -draftedId: new drafted id created by server
	 *  -message: resault message
	 *  -success: true if saving was successful otherwise false
	 *  -draftfolder: Name of draft folder including its delimiter
	 *
	 * @param {string} _action action is the element which caused saving draft, it could be as such:
	 *  -button[saveAsDraft]
	 *  -button[saveAsDraftAndPrint]
	 *  -autosaving
	 */
	savingDraft_response: function(_responseData, _action)
	{
		//Make sure there's a response from server otherwise shoot an error message
		if (jQuery.isEmptyObject(_responseData))
		{
			this.egw.message('Could not saved the message. Because, the response from server failed.', 'error');
			return false;
		}

		if (_responseData.success)
		{
			var content = this.et2.getArrayMgr('content');
			var lastDrafted = this.et2.getWidgetById('lastDrafted');
			var folderTree = typeof opener.etemplate2.getByApplication('mail')[0] !='undefined'?
								opener.etemplate2.getByApplication('mail')[0].widgetContainer.getWidgetById('nm[foldertree]'): null;
			var activeFolder = folderTree?folderTree.getSelectedNode():null;
			if (content)
			{
				var prevDraftedId = content.data.lastDrafted;
				content.data.lastDrafted = _responseData.draftedId;
				this.et2.setArrayMgr('content', content);
				lastDrafted.set_value(_responseData.draftedId);
				if (folderTree && activeFolder)
				{
					if (typeof activeFolder.id !='undefined' && _responseData.draftfolder == activeFolder.id)
					{
						if (prevDraftedId)
						{
							opener.egw_refresh(_responseData.message,'mail', prevDraftedId, 'delete');
						}
						this.egw.refresh(_responseData.message,'mail',_responseData.draftedId);
					}
				}
				switch (_action)
				{
					case 'button[saveAsDraftAndPrint]':
						this.mail_compose_print('mail::'+_responseData.draftedId);
						this.egw.message(_responseData.message);
						break;
					case 'autosaving':
						//Any sort of thing if it's an autosaving action
					default:
						this.egw.message(_responseData.message);
				}
			}
		}
		else
		{
			this.egw.message(_responseData.message, 'error');
		}
	},

	/**
	 * Focus handler for folder, address, reject textbox/taglist to automatic check associated radio button
	 *
	 * @param {event} _ev
	 * @param {object} _widget taglist
	 *
	 */
	sieve_focus_radioBtn: function(_ev, _widget)
	{
		_widget.getRoot().getWidgetById('action').set_value(_widget.id.replace(/^action_([^_]+)_text$/, '$1'));
	},

	/**
	 * Select all aliases
	 *
	 */
	sieve_vac_all_aliases: function()
	{
		var aliases = [];
		var tmp = [];
		var addr = this.et2.getWidgetById('addresses');
		var addresses = this.et2.getArrayMgr('sel_options').data.addresses;

		for(var id in addresses) aliases.push(id);
		if (addr)
		{
			tmp = aliases.concat(addr.get_value());

			// returns de-duplicate items of an array
			var deDuplicator = function (item,pos)
			{
				return tmp.indexOf(item) == pos;
			};

			aliases = tmp.filter(deDuplicator);
			addr.set_value(aliases);
		}
	},

	/**
	 * Disable/Enable date widgets on vacation seive rules form when status is "by_date"
	 *
	 */
	vacationFilterStatusChange: function()
	{
		var status = this.et2.getWidgetById('status');
		var s_date = this.et2.getWidgetById('start_date');
		var e_date = this.et2.getWidgetById('end_date');
		var by_date_label = this.et2.getWidgetById('by_date_label');

		if (status && s_date && e_date && by_date_label)
		{
			s_date.set_disabled(status.get_value() != "by_date");
			e_date.set_disabled(status.get_value() != "by_date");
			by_date_label.set_disabled(status.get_value() != "by_date");
		}
	},

	/**
	 * action - handling actions on sieve rules
	 *
	 * @param _type - action name
	 * @param _selected - selected row from the sieve rule list
	 */
	action: function(_type, _selected)
	{
		var  actionData ;
		var that = this;
		var typeId = _type.id;
		var linkData = '';
		var ruleID = ((_selected[0].id.split("_").pop()) - 1); // subtract the row id from 1 because the first row id is reserved by grid header
		if (_type)
		{

			switch (_type.id)
			{
				case 'delete':

					var callbackDeleteDialog = function (button_id)
					{
						if (button_id == et2_dialog.YES_BUTTON )
						{
							actionData = _type.parent.data.widget.getArrayMgr('content');
							that._do_action(typeId, actionData['data'],ruleID);
						}
					};
					et2_dialog.show_dialog(callbackDeleteDialog, this.egw.lang("Do you really want to DELETE this Rule"),this.egw.lang("Delete"), {},et2_dialog.BUTTONS_YES_CANCEL, et2_dialog.WARNING_MESSAGE);

					break;
				case 'add'	:
					linkData = "mail.mail_sieve.edit";
					this.egw.open_link(linkData,'_blank',"600x480");
					break;
				case 'edit'	:
					linkData = "mail.mail_sieve.edit&ruleID="+ruleID;
					this.egw.open_link(linkData,'_blank',"600x480");
					break;
				case 'enable':
					actionData = _type.parent.data.widget.getArrayMgr('content');
					this._do_action(typeId,actionData['data'],ruleID);
					break;
				case 'disable':
					actionData = _type.parent.data.widget.getArrayMgr('content');
					this._do_action(typeId,actionData['data'],ruleID);
					break;

			}
		}

	},

	/**
	* Send back sieve action result to server
	*
	* @param {string} _typeID action name
	* @param {object} _data content
	* @param {string} _selectedID selected row id
	* @param {string} _msg message
	*
	*/
	_do_action: function(_typeID, _data,_selectedID,_msg)
	{
		if (_typeID && _data)
		{
			var request = this.egw.json('mail.mail_sieve.ajax_action', [_typeID,_selectedID,_msg],null,null,true);
			request.sendRequest();
		}
	},

	/**
	* Send ajax request to server to refresh the sieve grid
	*/
	sieve_refresh: function()
	{
		this.et2._inst.submit();
	},

	/**
	 * Select the right combination of the rights for radio buttons from the selected common right
	 *
	 * @@param {jQuery event} event
	 * @param {widget} widget common right selectBox
	 *
	 */
	acl_common_rights_selector: function(event,widget)
	{
		var rowId = widget.id.replace(/[^0-9.]+/g, '');
		var rights = [];
		
		switch (widget.get_value())
		{
			case 'custom':
				break;
			case 'aeiklprstwx':
				rights = widget.get_value().replace(/[k,x,t,e]/g,"cd").split("");
				break;
			default:
				rights = widget.get_value().split("");
		}
		if (rights.length > 0)
		{
			for (var i=0;i<this.aclRights.length;i++)
			{
				var rightsWidget = this.et2.getWidgetById(rowId+'[acl_' + this.aclRights[i]+ ']');
				rightsWidget.set_value((jQuery.inArray(this.aclRights[i],rights) != -1 )?true:false);
			}
		}
	},

	/**
	 *
	 * Choose the right common right option for common ACL selecBox
	 *
	 * @param {jQuery event} event
	 * @param {widget} widget radioButton rights
	 *
	 */
	acl_common_rights: function(event, widget)
	{
	   var rowId = widget.id.replace(/[^0-9.]+/g, '');
	   var aclCommonWidget = this.et2.getWidgetById(rowId + '[acl]');
	   var rights = '';

	   for (var i=0;i<this.aclRights.length;i++)
	   {
		   var rightsWidget = this.et2.getWidgetById(rowId+'[acl_' + this.aclRights[i]+ ']');
		   if (rightsWidget.get_value() == "true")
			   rights += this.aclRights[i];

	   }

	   for (var i=0;i<this.aclCommonRights.length;i++)
	   {
		   if (rights.split("").sort().toString() == this.aclCommonRights[i].split("").sort().toString())
			   rights = this.aclCommonRights[i];
	   }
	   if (jQuery.inArray(rights,this.aclCommonRights ) == -1 && rights !='lrswipcda')
	   {
		   aclCommonWidget.set_value('custom');
	   }
	   else if (rights =='lrswipcda')
	   {
           aclCommonWidget.set_value('aeiklprstwx');
	   }
	   else
	   {
		   aclCommonWidget.set_value(rights);
	   }
	},

	/**
	 * Open seive filter list
	 *
	 * @param {action} _action
	 * @param {sender} _senders
	 *
	 */
	edit_sieve: function(_action, _senders)
	{
		var acc_id = parseInt(_senders[0].id);

		var url = this.egw.link('/index.php',{
					'menuaction': 'mail.mail_sieve.index',
					'acc_id': acc_id,
					'ajax': 'true'
		});

		// an ugly hack for idots to show up sieve rules not in an iframe
		// but as new link, better to remove it after get rid of idots template
		if (typeof window.framework == 'undefined')
		{
			this.egw.open_link(url);
		}
		else
		{
			this.loadIframe(url);
		}
	},

	/**
	 * Load an url on an iframe
	 *
	 * @param {string} _url string egw url
	 * @param {iframe widget} _iFrame an iframe to be set if non, extra_iframe is default
	 *
	 * @return {boolean} return TRUE if success, and FALSE if iframe not given
	 */
	loadIframe: function (_url, _iFrame)
	{
		var mailSplitter = this.et2.getWidgetById('mailSplitter');
		var quotaipercent = this.et2.getWidgetById('nm[quotainpercent]');
		var iframe = _iFrame || this.et2.getWidgetById('extra_iframe');
		if (typeof iframe != 'undefined' && iframe)
		{
			if (_url)
			{
				iframe.set_src(_url);
			}
			if (typeof mailSplitter != 'undefined' && mailSplitter && typeof quotaipercent != 'undefined')
			{
				mailSplitter.set_disabled(!!_url);
				quotaipercent.set_disabled(!!_url);
				iframe.set_disabled(!_url);
			}
			// extra_iframe used for showing up sieve rules
			// need some special handling for mobile device
			// as we wont have splitter, and also a fix for
			// iframe with display none
			if (iframe.id == "extra_iframe")
			{
				if (egwIsMobile())
				{
					var nm = this.et2.getWidgetById(this.nm_index);
					nm.set_disabled(!!_url);
					iframe.set_disabled(!_url);
				}
				// Set extra_iframe a class with height and width
				// and position relative, seems iframe display none
				// with 100% height/width covers mail tree and block
				// therefore block the click handling
				if (!iframe.disabled)
				{
					iframe.set_class('mail-index-extra-iframe');
				}
				else
				{
					iframe.set_class('');
				}
			}
			return true;
		}
		return false;
	},

	/**
	 * Edit vacation message
	 *
	 * @param {action} _action
	 * @param {sender} _senders
	 */
	edit_vacation: function(_action, _senders)
	{
		var acc_id = parseInt(_senders[0].id);
		this.egw.open_link('mail.mail_sieve.editVacation&acc_id='+acc_id,'_blank','700x480');
	},
	
	subscription_refresh: function(_data)
	{
		console.log(_data);
	},
	
	/**
	 * Submit on apply button and save current tree state
	 * 
	 * @param {type} _egw
	 * @param {type} _widget
	 * @returns {undefined}
	 */
	subscription_apply: function (_egw, _widget)
	{
		var tree = etemplate2.getByApplication('mail')[0].widgetContainer.getWidgetById('foldertree');
		if (tree)
		{
			tree.input._xfullXML = true;
			this.subscription_treeLastState = tree.input.serializeTreeToJSON();
		}
		this.et2._inst.submit(_widget);
	},
	
	/**
	 * Show ajax-loader when the autoloading get started
	 * 
	 * @param {type} _id item id
	 * @param {type} _widget tree widget
	 * @returns {Boolean}
	 */
	subscription_autoloadingStart: function (_id, _widget)
	{
		var node = _widget.input._globalIdStorageFind(_id);
		if (node && typeof node.htmlNode != 'undefined')
		{
			var img = jQuery('img',node.htmlNode)[0];
			img.src = egw.image('ajax-loader', 'admin');
		}
		return true;
	},
	
	/**
	 * Revert back the icon after autoloading is finished
	 * @returns {Boolean}
	 */
	subscription_autoloadingEnd: function ()
	{
		return true;
	},
	
	/**
	 * Popup the subscription dialog
	 *
	 * @param {action} _action
	 * @param {sender} _senders
	 */
	edit_subscribe: function (_action,_senders)
	{
		var acc_id = parseInt(_senders[0].id);
		this.egw.open_link('mail.mail_ui.subscription&acc_id='+acc_id, '_blank', '720x500');
	},

	/**
	 * Subscribe selected unsubscribed folder
	 *
	 * @param {action} _action
	 * @param {sender} _senders
	 */
	subscribe_folder: function(_action,_senders)
	{
		var mailbox = _senders[0].id.split('::');
		var folder = mailbox[1], acc_id = mailbox[0];
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		this.egw.message(this.egw.lang('Subscribe to Folder %1',ftree.getLabel(_senders[0].id).replace(this._unseen_regexp,'')));
		egw.json('mail.mail_ui.ajax_foldersubscription',[acc_id,folder,true])
			.sendRequest();
	},

	/**
	 * Unsubscribe selected subscribed folder
	 *
	 * @param {action} _action
	 * @param {sender} _senders
	 */
	unsubscribe_folder: function(_action,_senders)
	{
		var mailbox = _senders[0].id.split('::');
		var folder = mailbox[1], acc_id = mailbox[0];
		var ftree = this.et2.getWidgetById(this.nm_index+'[foldertree]');
		this.egw.message(this.egw.lang('Unsubscribe from Folder %1',ftree.getLabel(_senders[0].id).replace(this._unseen_regexp,'')));
		egw.json('mail.mail_ui.ajax_foldersubscription',[acc_id,folder,false])
			.sendRequest();
	},

	/**
	 * Onclick for node/foldername in subscription popup
	 *
	 * Used to (un)check node including all children
	 *
	 * @param {string} _id id of clicked node
	 * @param {et2_tree} _widget reference to tree widget
	 */
	subscribe_onclick: function(_id, _widget)
	{
		_widget.setSubChecked(_id, "toggle");
	},

	/**
	 * Edit a folder acl for account(s)
	 *
	 * @param _action
	 * @param _senders - the representation of the tree leaf to be manipulated
	 */
	edit_acl: function(_action, _senders)
	{
		var mailbox = _senders[0].id.split('::');
		var folder = mailbox[1] || 'INBOX', acc_id = mailbox[0];
		this.egw.open_link('mail.mail_acl.edit&mailbox='+ jQuery.base64Encode(folder)+'&acc_id='+acc_id, '_blank', '640x480');
	},

	/**
	 * Submit new selected folder back to server in order to read its acl's rights
	 */
	acl_folderChange: function ()
	{
		var mailbox = this.et2.getWidgetById('mailbox');

		if (mailbox)
		{
			if (mailbox.taglist.getValue().length > 0)
			{
				this.et2._inst.submit();
			}
		}
	},

	/**
	 * Edit a mail account
	 *
	 * @param _action
	 * @param _senders - the representation of the tree leaf to be manipulated
	 */
	edit_account: function(_action, _senders)
	{
		var acc_id = parseInt(_senders[0].id);
		this.egw.open_link('mail.mail_wizard.edit&acc_id='+acc_id, '_blank', '720x500');
	},

	/**
	 * Set expandable fields (Folder, Cc and Bcc) based on their content
	 * - Only fields which have no content should get hidden
	 */
	compose_fieldExpander_init: function ()
	{
		var widgets = {
			cc:{
				widget:{},
				jQClass: '.mailComposeJQueryCc'
			},
			bcc:{
				widget:{},
				jQClass: '.mailComposeJQueryBcc'
			},
			folder:{
				widget:{},
				jQClass: '.mailComposeJQueryFolder'
			},
			replyto:{
				widget:{},
				jQClass: '.mailComposeJQueryReplyto'
			}};

		for(var widget in widgets)
		{
			var expanderBtn = widget + '_expander';
			widgets[widget].widget = this.et2.getWidgetById(widget);
			// Add expander button widget to the widgets object
			widgets[expanderBtn] = {widget:this.et2.getWidgetById(expanderBtn)};

			if (typeof widgets[widget].widget != 'undefined'
					&& typeof widgets[expanderBtn].widget != 'undefined'
					&& widgets[widget].widget.get_value().length == 0)
			{
				widgets[expanderBtn].widget.set_disabled(false);
				jQuery(widgets[widget].jQClass).hide();
			}
		}
	},

	/**
	 * Control textArea size based on available free space at the bottom
	 *
	 */
	compose_resizeHandler: function()
	{
		// Do not resize compose dialog if it's running on mobile device
		// in this case user would be able to edit mail body by scrolling down,
		// which is more convenient on small devices. Also resize mailbody with
		// ckeditor may causes performance regression, especially on devices with
		// very limited resources and slow proccessor.
		if (egwIsMobile()) return;

		var bodyH = egw_getWindowInnerHeight();
		var textArea = this.et2.getWidgetById('mail_plaintext');
		var $headerSec = jQuery('.mailComposeHeaderSection');
		var attachments = this.et2.getWidgetById('attachments');
		var content = this.et2.getArrayMgr('content').data;

		// @var arrbitary int represents px
		// Visible height of attachment progress
		var prgV_H = 150;

		// @var arrbitary int represents px
		// Visible height of attchements list
		var attchV_H = 68;

		if (typeof textArea != 'undefined' && textArea != null)
		{
			if (textArea.getParent().disabled)
			{
				textArea = this.et2.getWidgetById('mail_htmltext');
			}
			// Tolerate values base on plain text or html, in order to calculate freespaces
			var textAreaDelta = textArea.id == "mail_htmltext"?20:40;

			// while attachments are in progress take progress visiblity into account
			// otherwise the attachment progress is finished and consider attachments list
			var delta = (attachments.table.find('li').length>0 && attachments.table.height() > 0)? prgV_H: (content.attachments? attchV_H: textAreaDelta);

			var bodySize = (bodyH  - Math.round($headerSec.height() + $headerSec.offset().top) - delta);

			if (textArea.id != "mail_htmltext")
			{
				textArea.getParent().set_height(bodySize);
				textArea.set_height(bodySize);
			}
			else if (typeof textArea != 'undefined' && textArea.id == 'mail_htmltext')
			{
				textArea.ckeditor.resize('100%', bodySize);
			}
			else
			{
				textArea.set_height(bodySize - 90);
			}
		}
	},

	/**
	 * Display Folder,Cc or Bcc fields in compose popup
	 *
	 * @param {jQuery event} event
	 * @param {widget object} widget clicked label (Folder, Cc or Bcc) from compose popup
	 *
	 */
	compose_fieldExpander: function(event,widget)
	{
		var expWidgets = {cc:{},bcc:{},folder:{},replyto:{}};
		for (var name in expWidgets)
		{
			expWidgets[name] = this.et2.getWidgetById(name+'_expander');
		}

		if (typeof widget !='undefined')
		{
			switch (widget.id)
			{
				case 'cc_expander':
					jQuery(".mailComposeJQueryCc").show();
					if (typeof expWidgets.cc !='undefined')
					{
						expWidgets.cc.set_disabled(true);
					}
					break;
				case 'bcc_expander':
					jQuery(".mailComposeJQueryBcc").show();
					if (typeof expWidgets.bcc !='undefined')
					{
						expWidgets.bcc.set_disabled(true);
					}
					break;
				case 'folder_expander':
					jQuery(".mailComposeJQueryFolder").show();
					if (typeof expWidgets.folder !='undefined')
					{
						expWidgets.folder.set_disabled(true);
					}
					break;
				case 'replyto_expander':
					jQuery(".mailComposeJQueryReplyto").show();
					if (typeof expWidgets.replyto !='undefined')
					{
						expWidgets.replyto.set_disabled(true);
					}
					break;
			}
		}
		else if (typeof widget == "undefined")
		{
			var widgets = {cc:{},bcc:{},folder:{},replyto:{}};

			for(var widget in widgets)
			{
				widgets[widget] = this.et2.getWidgetById(widget);

				if (widgets[widget].get_value().length)
				{
					switch (widget)
					{
						case 'cc':
							jQuery(".mailComposeJQueryCc").show();
							if (typeof expWidgets.cc != 'undefiend')
							{
								expWidgets.cc.set_disabled(true);
							}
							break;
						case 'bcc':
							jQuery(".mailComposeJQueryBcc").show();
							if (typeof expWidgets.bcc != 'undefiend')
							{
								expWidgets.bcc.set_disabled(true);
							}
							break;
						case 'folder':
							jQuery(".mailComposeJQueryFolder").show();
							if (typeof expWidgets.folder != 'undefiend')
							{
								expWidgets.folder.set_disabled(true);
							}
							break;
						case 'replyto':
							jQuery(".mailComposeJQueryReplyto").show();
							if (typeof expWidgets.replyto != 'undefiend')
							{
								expWidgets.replyto.set_disabled(true);
							}
							break;
					}
				}
			}
		}
		this.compose_resizeHandler();
	},

	/**
	 * Lock tree so it does NOT receive any more mouse-clicks
	 */
	lock_tree: function()
	{
		if (!document.getElementById('mail_folder_lock_div'))
		{
			var parent = jQuery('#mail-index_nm\\[foldertree\\]');
			var lock_div = jQuery(document.createElement('div'));
			lock_div.attr('id', 'mail_folder_lock_div')
				.addClass('mail_folder_lock');
			parent.prepend(lock_div);
		}
	},

	/**
	 * Unlock tree so it receives again mouse-clicks after calling lock_tree()
	 */
	unlock_tree: function()
	{
		jQuery('#mail_folder_lock_div').remove();
	},

	/**
	 * Called when tree opens up an account or folder
	 *
	 * @param {String} _id account-id[::folder-name]
	 * @param {et2_widget_tree} _widget
	 * @param {Number} _hasChildren 0 - item has no child nodes, -1 - item is closed, 1 - item is opened
	 */
	openstart_tree: function(_id, _widget, _hasChildren)
	{
		if (_id.indexOf('::') == -1 &&	// it's an account, not a folder in an account
			!_hasChildren)
		{
			this.lock_tree();
		}
		return true;	// allow opening of node
	},

	/**
	 * Called when tree opens up an account or folder
	 *
	 * @param {String} _id account-id[::folder-name]
	 * @param {et2_widget_tree} _widget
	 * @param {Number} _hasChildren 0 - item has no child nodes, -1 - item is closed, 1 - item is opened
	 */
	openend_tree: function(_id, _widget, _hasChildren)
	{
		if (_id.indexOf('::') == -1 &&	// it's an account, not a folder in an account
			_hasChildren == 1)
		{
			this.unlock_tree();
		}
	},

	/**
	 * Print a mail from list

	 * @param _action
	 * @param _senders - the representation of the tree leaf to be manipulated
	 */
	mail_print: function(_action, _senders)
	{
		var currentTemp = this.et2._inst.name;

		switch (currentTemp)
		{
			case 'mail.index':
				this.mail_prev_print(_action, _senders);
				break;
			case 'mail.display':
				this.mail_display_print();
		}

	},

	/**
	 * Print a mail from compose
	 * @param {stirng} _id id of new draft
	 */
	mail_compose_print:function (_id)
	{
		this.egw.open(_id,'mail','view','&print='+_id+'&mode=print');
	},

	/**
	 * Bind special handler on print media.
	 * -FF and IE have onafterprint event, and as Chrome does not have that event we bind afterprint function to onFocus
	 */
	print_for_compose: function()
	{
		var afterprint = function (){
			egw(window).close();
		};

		if (!window.onafterprint)
		{
			// For browsers which does not support onafterprint event, eg. Chrome
			setTimeout(function() {
				egw(window).close();
			}, 2000);
		}
		else
		{
			window.onafterprint = afterprint;
		}
	},

	/**
	 * Prepare display dialog for printing
	 * copies iframe content to a DIV, as iframe causes
	 * trouble for multipage printing
	 *
	 * @returns {undefined}
	 */
	mail_prepare_print: function()
	{
		var mainIframe = jQuery('#mail-display_mailDisplayBodySrc');
		var tmpPrintDiv = jQuery('#tempPrintDiv');

		if (tmpPrintDiv.length == 0 && tmpPrintDiv.children())
		{
			tmpPrintDiv = jQuery(document.createElement('div'))
							.attr('id', 'tempPrintDiv')
							.addClass('tmpPrintDiv');
			var notAttached = true;
		}

		if (mainIframe)
		{
			tmpPrintDiv[0].innerHTML = mainIframe.contents().find('body').html();
		}
		// Attach the element to the DOM after maniupulation
		if (notAttached) jQuery('#mail-display_mailDisplayBodySrc').after(tmpPrintDiv);
		tmpPrintDiv.find('#divAppboxHeader').remove();

	},

	/**
	 * Print a mail from Display
	 */
	mail_display_print: function ()
	{
		this.egw.message('Printing....');

		// Make sure the print happens after the content is loaded. Seems Firefox and IE can't handle timing for print command correctly
		setTimeout(function(){
			egw(window).window.print();
		},100);
	},

	/**
	 * Print a mail from list
	 *
	 * @param {Object} _action
	 * @param {Object} _elems
	 *
	 */
	mail_prev_print: function (_action, _elems)
	{
		this.mail_open(_action, _elems, 'print');
	},

	/**
	 * Print a mail from list
	 *
	 * @param {egw object} _egw
	 * @param {widget object} _widget mail account selectbox
	 *
	 */
	vacation_change_account: function (_egw, _widget)
	{
		_widget.getInstanceManager().submit();
	},

	/**
	 * OnChange callback for recipients:
	 * - make them draggable
	 * - check if we have keys for recipients, if we compose an encrypted mail
	 **/
	recipients_onchange: function()
	{
		// if we compose an encrypted mail, check if we have keys for new recipient
		if (this.mailvelope_editor)
		{
			var self = this;
			this.mailvelopeGetCheckRecipients().catch(function(_err)
			{
				self.egw.message(_err.message, 'error');
			});
		}
		this.set_dragging_dndCompose();
	},

	/**
	 * Make recipients draggable
	 */
	set_dragging_dndCompose: function ()
	{
		var zIndex = 100;
		var dragItems = jQuery('div.ms-sel-item:not(div.ui-draggable)');
		dragItems.each(function(i,item){
				var $isErr = jQuery(item).find('.ui-state-error');
				if ($isErr.length > 0)
				{
					delete dragItems.splice(i,1);
				}
			});
		if (dragItems.length > 0)
		{
			dragItems.draggable({
				appendTo:'body',
				//Performance wise better to not add ui-draggable class to items since we are not using that class
				containment:'document',
				distance: 0,
				cursor:'move',
				cursorAt:{left:2},
				//cancel dragging on close button to avoid conflict with close action
				cancel:'.ms-close-btn',
				delay: '300',
				/**
				 * function to act on draggable item on revert's event
				 * @returns {Boolean} return true
				 */
				revert: function (){
					this.parent().find('.ms-sel-item').css('position','relative');
					return true;
				},
				/**
				 * function to act as draggable starts dragging
				 *
				 * @param {type} event
				 * @param {type} ui
				 */
				start:function(event, ui)
				{
					var dragItem = jQuery(this);
					if (event.ctrlKey || event.metaKey)
					{
						dragItem.addClass('mailCompose_copyEmail')
								.css('cursor','copy');
					}
					dragItem.css ('z-index',zIndex++);
					dragItem.css('position','absolute');
				},
				/**
				 *
				 * @param {type} event
				 * @param {type} ui
				 */
				create:function(event,ui)
				{
					jQuery(this).css('css','move');
				}
			}).draggable('disable');
			window.setTimeout(function(){

				if(dragItems && dragItems.data() && typeof dragItems.data()['uiDraggable'] !== 'undefined') dragItems.draggable('enable');
			},100);
		}

	},

	/**
	 * Initialize dropping targets for draggable emails
	 * -
	 */
	init_dndCompose: function ()
	{

		var self = this;
		var emailTags = jQuery('#mail-compose_to,#mail-compose_cc,#mail-compose_bcc');
		//Call to make new items draggable
		emailTags.hover(function(){
			self.set_dragging_dndCompose();
		});
		//Make used email-tag list widgets in mail compose droppable
		emailTags.droppable({
			accept:'.ms-sel-item',

			/**
			 * Run after a draggable email item dropped over one of the email-taglists
			 * -Set the dropped item to the dropped current target widget
			 *
			 * @param {type} event
			 * @param {type} ui
			 */
			drop:function (event, ui)
			{
				var widget = self.et2.getWidgetById(this.getAttribute('name'));
				var emails, distLists = [];
				var fromWidget = {};
				
				var parentWidgetDOM = ui.draggable.parentsUntil('div[id^="mail-compoe_"]','.ui-droppable');
				if (parentWidgetDOM != 'undefined' && parentWidgetDOM.length > 0)
				{
					fromWidget = self.et2.getWidgetById(parentWidgetDOM.attr('name'));
				}
				
				var draggedValue = ui.draggable.text();
				
				// index of draggable item in selection list
				var dValueKey = draggedValue;
				
				var distItem = ui.draggable.find('.mailinglist');
				if (distItem.length>0)
				{
					var distItemId = parseInt(distItem.attr('data'));
					if (distItemId)
					{
						var fromDistLists = resolveDistList(fromWidget);
						for (var i=0;i<fromDistLists.length;i++)
						{
							if (distItemId == fromDistLists[i]['id'])
							{
								draggedValue = fromDistLists[i];
								// dist list item index
								dValueKey = fromDistLists[i]['id'];
							}
						}
					}
				}
				
				if (typeof widget != 'undefined')
				{
					emails = widget.get_value();
					if (emails) emails = emails.concat([draggedValue]);
					
					// Resolve the dist list and normal emails
					distLists = resolveDistList(widget, emails);
					
					// Add normal emails
					if (emails) widget.set_value(emails);
					
					// check if there's any dist list to be added
					if (distLists.length>0) widget.taglist.addToSelection(distLists);

					if (!jQuery.isEmptyObject(fromWidget)
							&& !(ui.draggable.attr('class').search('mailCompose_copyEmail') > -1))
					{
						if (!_removeDragged(fromWidget, dValueKey))
						{
							//Not successful remove, returns the item to its origin
							jQuery(ui.draggable).draggable('option','revert',true);
						}
					}
					else
					{
						ui.draggable
								.removeClass('mailCompose_copyEmail')
								.css('cursor','move');
					}

					var dragItems = jQuery('div.ms-sel-item');
					dragItems.each(function(i,item){
						var $isErr = jQuery(item).find('.ui-state-error');
						if ($isErr.length > 0)
						{
							delete dragItems.splice(i,1);
						}
					});
					//Destroy draggables after dropping, we need to enable them again
					dragItems.draggable('destroy');
				}
			}
		});

		/**
		 * Remove dragged item from the widget which the item was dragged
		 *
		 * @param {type} _widget
		 * @param {type} _value
		 * @return {boolean} true if successul | false unsuccessul
		 */
		var _removeDragged = function (_widget, _value)
		{
			if (_widget && _value)
			{
				var emails = _widget.get_value();
				var itemIndex = emails.indexOf(_value);
				var dist = [];
				if (itemIndex > -1)
				{
					emails.splice(itemIndex,1);
					// Resolve the dist list and normal emails
					var dist = resolveDistList(_widget, emails);
					
					// Add normal emails
					_widget.set_value(emails);
					
					//check if there's any dist list to be added
					if (dist)
					{
						for(var i=0;i<dist.length;i++)
						{
							if (dist[i]['id'] == _value) dist.splice(i,1);
						}
						_widget.taglist.addToSelection(dist);
					}
				}
				else
				{
					return false;
				}
			}
			return true;
		};
		
		/**
		 * Resolve taglist widget which has distribution list
		 * 
		 * @param {type} _widget
		 * @param {type} _emails
		 * @returns {Array} returns an array of distribution lists in selected widget
		 */
		var resolveDistList = function (_widget, _emails)
		{
			var list = [];
			var selectedList = _widget.taglist.getSelection();
			// Make a list of distribution list from the selection
			for (var i=0;i<selectedList.length;i++)
			{
				if (!isNaN(selectedList[i]['id']) && selectedList[i]['class'] === 'mailinglist')
				{
					list.push(selectedList[i]);
				}
			}
			
			// Remove dist list from emails list
			for(var key in _emails)
			{
				if (!isNaN(_emails[key]))
				{
					_emails.splice(key,1);
				}
			}
			// returns distlist
			return list;
		};
	},

	/**
	* Check sharing mode and disable not available options
	*
	* @param {DOMNode} _node
	* @param {et2_widget} _widget
	*/
	check_sharing_filemode: function(_node, _widget)
	{
		if (!_widget) _widget = this.et2.getWidgetById('filemode');

		var extended_settings = _widget.get_value() != 'attach' && this.egw.app('stylite');
		this.et2.getWidgetById('expiration').set_readonly(!extended_settings);
		this.et2.getWidgetById('password').set_readonly(!extended_settings);

		if (_widget.get_value() == 'share_rw' && !this.egw.app('stylite'))
		{
			this.egw.message(this.egw.lang('Writable sharing requires EPL version!'), 'info');
			_widget.set_value('share_ro');
		}
	},

	/**
	 * Write / update compose window title with subject
	 *
	 * @param {DOMNode} _node
	 * @param {et2_widget} _widget
	 */
	subject2title: function(_node, _widget)
	{
		if (!_widget) _widget = this.et2.getWidgetById('subject');

		if (_widget && _widget.get_value())
		{
			document.title = _widget.get_value();
		}
	},

	/**
	 * Clear intervals stored in W_INTERVALS which assigned to window
	 */
	clearIntevals: function ()
	{
		for(var i=0;i<this.W_INTERVALS.length;i++)
		{
			clearInterval(this.W_INTERVALS[i]);
			delete this.W_INTERVALS[i];
		}
	},

	/**
	 * Window title getter function in order to set the window title
	 *
	 * @returns {string} window title
	 */
	getWindowTitle: function ()
	{
		var widget = {};
		switch(this.et2._inst.name)
		{
			case 'mail.display':
				widget = this.et2.getWidgetById('mail_displaysubject');
				if (widget) return widget.options.value;
				break;
			case 'mail.compose':
				widget = this.et2.getWidgetById('subject');
				if (widget) return widget.get_value();
				break;
		}
	},
	
	/**
	 * 
	 * @returns {undefined}
	 */
	prepareMailvelopePrint: function()
	{
		var tempPrint = jQuery('div#tempPrintDiv');
		var mailvelopeTopContainer = jQuery('div.mailDisplayContainer');
		var originFrame = jQuery('#mail-display_mailDisplayBodySrc');
		var iframe = jQuery(this.mailvelope_iframe_selector);
		
		if (tempPrint.length >0)
		{
			// Mailvelope iframe height is approximately equal to the height of encrypted origin message
			// we add an arbitary plus pixels to make sure it's covering the full content in print view and
			// it is not getting acrollbar in normal view
			// @TODO: after Mailvelope plugin provides a hieght value, we can replace the height with an accurate value
			iframe.addClass('mailvelopeIframe').height(originFrame[0].contentWindow.document.body.scrollHeight + 400);
			tempPrint.hide();
			mailvelopeTopContainer.addClass('mailvelopeTopContainer');
		}
	},
	
	/**
	 * Mailvelope (clientside PGP) integration:
	 * - detect Mailvelope plugin and open "egroupware" keyring (app_base.mailvelopeAvailable and _mailvelopeOpenKeyring)
	 * - display and preview of encrypted messages (mailvelopeDisplay)
	 * - button to toggle between regular and encrypted mail (togglePgpEncrypt)
	 * - compose encrypted messages (mailvelopeCompose, compose_submitAction)
	 * - fix autosave and save as draft to store encrypted content (saveAsDraft)
	 * - fix inline reply to encrypted message to clientside decrypt message and add signature (mailvelopeCompose)
	 */

	/**
	 * Called on load of preview or display iframe, if mailvelope is available
	 *
	 * @param {Keyring} _keyring Mailvelope keyring to use
	 * @ToDo signatures
	 */
	mailvelopeDisplay: function(_keyring)
	{
		var self = this;
		var mailvelope = window.mailvelope;
		var iframe = jQuery('iframe#mail-display_mailDisplayBodySrc,iframe#mail-index_messageIFRAME');
		var armored = iframe.contents().find('td.td_display > pre').text().trim();

		if (armored == "" || armored.indexOf(this.begin_pgp_message) === -1) return;

		var container = iframe.parent()[0];
		var container_selector = container.id ? '#'+container.id : 'div.mailDisplayContainer';
		mailvelope.createDisplayContainer(container_selector, armored, _keyring).then(function()
		{
			// hide our iframe to give space for mailvelope iframe with encrypted content
			iframe.hide();
			self.prepareMailvelopePrint();
		},
		function(_err)
		{
			self.egw.message(_err.message, 'error');
		});
	},

	/**
	 * Editor object of active compose
	 *
	 * @var {Editor}
	 */
	mailvelope_editor: undefined,

	/**
	 * Called on compose, if mailvelope is available
	 *
	 * @param {Keyring} _keyring Mailvelope keyring to use
	 */
	mailvelopeCompose: function(_keyring)
	{
		delete this.mailvelope_editor;

		// currently Mailvelope only supports plain-text, to this is unnecessary
		var mimeType = this.et2.getWidgetById('mimeType');
		var is_html = mimeType.get_value();
		var container = is_html ? '.mailComposeHtmlContainer' : '.mailComposeTextContainer';
		var editor = this.et2.getWidgetById(is_html ? 'mail_htmltext' : 'mail_plaintext');
		var options = { predefinedText: editor.get_value() };

		// check if we have some sort of reply to an encrypted message
		// --> parse header, encrypted mail to quote and signature so Mailvelope understands it
		var start_pgp = options.predefinedText.indexOf(this.begin_pgp_message);
		if (start_pgp != -1)
		{
			var end_pgp = options.predefinedText.indexOf(this.end_pgp_message);
			if (end_pgp != -1)
			{
				options = {
					quotedMailHeader: options.predefinedText.slice(0, start_pgp).replace(/> /mg, '').trim()+"\n",
					quotedMail: options.predefinedText.slice(start_pgp, end_pgp+this.end_pgp_message.length+1).replace(/> /mg, ''),
					quotedMailIndent: start_pgp != 0,
					predefinedText: options.predefinedText.slice(end_pgp+this.end_pgp_message.length+1).replace(/^> \s*/m,'')
				};
				// set encrypted checkbox, if not already set
				var composeToolbar = this.et2.getWidgetById('composeToolbar');
				if (!composeToolbar.checkbox('pgp'))
				{
					composeToolbar.checkbox('pgp',true);
				}
			}
		}

		var self = this;
		mailvelope.createEditorContainer(container, _keyring, options).then(function(_editor)
		{
			self.mailvelope_editor = _editor;
			editor.set_disabled(true);
			mimeType.set_readonly(true);
		},
		function(_err)
		{
			self.egw.message(_err.message, 'error');
		});
	},

	/**
	 * Switch sending PGP encrypted mail on and off
	 *
	 * @param {object} _action toolbar action
	 */
	togglePgpEncrypt: function (_action)
	{
		var self = this;
		if (_action.checked)
		{
			if (typeof mailvelope == 'undefined')
			{
				this.egw.message(this.egw.lang('You need to install Mailvelope plugin available for Chrome and Firefox from %1.','<a href="https://www.mailvelope.com/">mailvelope.com</a>')+"\n"+
					this.egw.lang('Add your domain as "%1" in options to list of email providers and enable API.',
					'*.'+this._mailvelopeDomain()), 'info');
				// switch encrypt button off again
				this.et2.getWidgetById('composeToolbar')._actionManager.getActionById('pgp').set_checked(false);
				jQuery('button#composeToolbar-pgp').toggleClass('toolbar_toggled');
				return;
			}
			// check if we have keys for all recipents, before switching
			this.mailvelopeGetCheckRecipients().then(function(_recipients)
			{
				var mimeType = self.et2.getWidgetById('mimeType');
				// currently Mailvelope only supports plain-text, switch to it if necessary
				if (mimeType.get_value())
				{
					mimeType.set_value(false);
					self.et2._inst.submit();
					return;	// ToDo: do that without reload
				}
				self.mailvelopeOpenKeyring().then(function(_keyring)
				{
					self.mailvelopeCompose(_keyring);
				});
			})
			.catch(function(_err)
			{
				self.egw.message(_err.message, 'error');
				self.et2.getWidgetById('composeToolbar')._actionManager.getActionById('pgp').set_checked(false);
				jQuery('button#composeToolbar-pgp').toggleClass('toolbar_toggled');
				return;
			});
		}
		else
		{
			// switch Mailvelop off again, but warn user he will loose his content
			et2_dialog.show_dialog(function (_button_id)
			{
				if (_button_id == et2_dialog.YES_BUTTON )
				{
					self.et2.getWidgetById('mimeType').set_readonly(false);
					self.et2.getWidgetById('mail_plaintext').set_disabled(false);
					jQuery(self.mailvelope_iframe_selector).remove();
				}
				else
				{
					self.et2.getWidgetById('composeToolbar').checkbox('pgp',true);
				}
			},
			this.egw.lang('You will loose current message body, unless you save it to your clipboard!'),
			this.egw.lang('Switch off encryption?'),
			{}, et2_dialog.BUTTON_YES_NO, et2_dialog.WARNING_MESSAGE, undefined, this.egw);
		}
	},

	/**
	 * Check if we have a key for all recipients
	 *
	 * @returns {Promise.<Array, Error>} Array of recipients or Error with recipients without key
	 */
	mailvelopeGetCheckRecipients: function()
	{
		// collect all recipients
		var recipients = this.et2.getWidgetById('to').get_value();
		recipients = recipients.concat(this.et2.getWidgetById('cc').get_value());
		recipients = recipients.concat(this.et2.getWidgetById('bcc').get_value());

		return this._super.call(this, recipients);
	},

	/**
	 * Set the relevant widget to toolbar actions and submit
	 *
	 * @param {type} _action toolbar action
	 */
	compose_submitAction: function (_action)
	{
		if (this.mailvelope_editor)
		{
			var self = this;
			this.mailvelopeGetCheckRecipients().then(function(_recipients)
			{
				return self.mailvelope_editor.encrypt(_recipients);
			}).then(function(_armored)
			{
				self.et2.getWidgetById('mimeType').set_value(false);
				self.et2.getWidgetById('mail_plaintext').set_disabled(false);
				self.et2.getWidgetById('mail_plaintext').set_value(_armored);
				self.et2._inst.submit(null,null,true);
			}).catch(function(_err)
			{
				self.egw.message(_err.message, 'error');
			});
			return false;
		}
		this.et2._inst.submit(null,null,true);
	},

	/**
	 * Set the selected checkbox action
	 *
	 * @param {type} _action selected toolbar action with checkbox
	 * @returns {undefined}
	 */
	compose_setToggle: function (_action)
	{
		var widget = this.et2.getWidgetById (_action.id);
		if (widget && typeof _action.checkbox != 'undefined' && _action.checkbox)
		{
			widget.set_value(_action.checked?"on":"off");
		}
	},

	/**
	 * Set the selected priority value
	 * @param {type} _action selected action
	 * @returns {undefined}
	 */
	compose_priorityChange: function (_action)
	{
		var widget = this.et2.getWidgetById ('priority');
		if (widget)
		{
			widget.set_value(_action.id);
		}
	},

	/**
	 * Triger relative widget via its toolbar identical action
	 * @param {type} _action toolbar action
	 */
	compose_triggerWidget:function (_action)
	{
		var widget = this.et2.getWidgetById(_action.id);
		if (widget)
		{
			switch(widget.id)
			{
				case 'uploadForCompose':
					document.getElementById('mail-compose_uploadForCompose').click();
					break;
				default:
					widget.click();
			}
		}
	},

	/**
	 * Save drafted compose as eml file into VFS
	 * @param {type} _action action
	 */
	compose_saveDraft2fm: function (_action)
	{
		var content = this.et2.getArrayMgr('content').data;
		var subject = this.et2.getWidgetById('subject');
		var elem = {0:{id:"", subject:""}};
		if (typeof content != 'undefined' && content.lastDrafted && subject)
		{
			elem[0].id = content.lastDrafted;
			elem[0].subject = subject.get_value();
			this.mail_save2fm(_action, elem);
		}
		else
		{
			et2_dialog.alert('You need to save the message as draft first before to be able to save it into VFS','Save into VFS','info');
		}
	},
	
	/**
	 * Folder Management, opens the folder magnt. dialog
	 * with the selected acc_id from index tree
	 * 
	 * @param {egw action object} _action actions
	 * @param {object} _senders selected node
	 */
	folderManagement: function (_action,_senders)
	{
		var acc_id = parseInt(_senders[0].id);
		this.egw.open_link('mail.mail_ui.folderManagement&acc_id='+acc_id, '_blank', '720x500');
	},
	
	/**
	 * Show ajax-loader when the autoloading get started
	 * 
	 * @param {type} _id item id
	 * @param {type} _widget tree widget
	 * @returns {Boolean}
	 */
	folderMgmt_autoloadingStart: function(_id, _widget)
	{
		return this.subscription_autoloadingStart (_id, _widget);
	},
	
	/**
	 * Revert back the icon after autoloading is finished
	 * @returns {Boolean}
	 */
	folderMgmt_autoloadingEnd: function(_id, _widget)
	{
		return true;
	},
	
	/**
	 * 
	 * @param {type} _ids
	 * @param {type} _widget
	 * @returns {undefined}
	 */
	folderMgmt_onSelect: function(_ids, _widget)
	{
		// Flag to reset selected items
		var resetSelection = false;
		
		var self = this;
		
		/**
		 * helper function to multiselect range of nodes in same level
		 * 
		 * @param {string} _a start node id
		 * @param {string} _b end node id
		 * @param {string} _branch totall node ids in the level
		 */
		var rangeSelector = function(_a,_b, _branch)
		{
			var branchItems = _branch.split(_widget.input.dlmtr);
			var _aIndex = _widget.input.getIndexById(_a);
			var _bIndex = _widget.input.getIndexById(_b);
			if (_bIndex<_aIndex)
			{
				var tmpIndex = _aIndex;
				_aIndex = _bIndex;
				_bIndex = tmpIndex;
			}
			for(var i =_aIndex;i<=_bIndex;i++)
			{
				self.folderMgmt_setCheckbox(_widget, branchItems[i], !_widget.input.isItemChecked(branchItems[i]));
			}
		};
		
		// extract items ids
		var itemIds = _ids.split(_widget.input.dlmtr);

		if(itemIds.length == 2) // there's a range selected
		{
			var branch = _widget.input.getSubItems(_widget.input.getParentId(itemIds[0]));
			// Set range of selected/unselected
			rangeSelector(itemIds[0], itemIds[1], branch);
		}
		else if(itemIds.length != 1)
		{
			resetSelection = true;
		}
		
		if (resetSelection)
		{
			_widget.input._unselectItems();
		}
	},
	
	/**
	 * Set enable/disable checkbox
	 * 
	 * @param {object} _widget tree widget
	 * @param {string} _itemId item tree id
	 * @param {boolean} _stat - status to be set on checkbox true/false
	 */
	folderMgmt_setCheckbox: function (_widget, _itemId, _stat)
	{
		if (_widget)
		{
			_widget.input.setCheck(_itemId, _stat);
			_widget.input.setSubChecked(_itemId,_stat);
		}
	},
	
	/**
	 * 
	 * @param {type} _id
	 * @param {type} _widget
	 * @TODO: Implement onCheck handler in order to select or deselect subItems
	 *	of a checked parent node
	 */
	folderMgmt_onCheck: function (_id, _widget)
	{
		console.log();
	},
	
	/**
	 * Detele button handler
	 * triggers longTask dialog and send delete operation url
	 * 
	 */
	folderMgmt_deleteBtn: function ()
	{
		var tree = etemplate2.getByApplication('mail')[0].widgetContainer.getWidgetById('tree');
		var menuaction= 'mail.mail_ui.ajax_folderMgmt_delete';
		
		if (tree)
		{
			var selFolders = tree.input.getAllChecked();
			if (selFolders)
			{
				var selFldArr = selFolders.split(tree.input.dlmtr);
				var msg = egw.lang('Folders deleting in progress ...');
				et2_dialog.long_task(function(_val, _resp){
					console.log(_val, _resp);
					if (_val && _resp.type !== 'error')
					{
						var stat = [];
						var folderName = '';
						for(var i=0;i<selFldArr.length;i++)
						{
							folderName = selFldArr[i].split('::');
							stat[selFldArr[i]] = folderName[1];
						}
						// delete the item from index folderTree
						egw.window.app.mail.mail_removeLeaf(stat);
						// submit
						etemplate2.getByApplication('mail')[0].widgetContainer._inst.submit();
					}
				}, msg, 'Deleting folders', menuaction, selFldArr, 'mail');
				return true;
			}
		}
	}
	
	
});
