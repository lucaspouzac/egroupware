<?php
/**
 * EGroupware - Mail - interface class
 *
 * @link http://www.egroupware.org
 * @package mail
 * @author Hadi Nategh [hn@stylite.de]
 * @copyright (c) 2013 by Hadi Nategh <hn-AT-stylite.de>
 * @license http://opensource.org/licenses/gpl-license.php GPL - GNU General Public License
 * @version $Id: class.mail_ui.inc.php 42779 2013-06-17 14:25:20Z leithoff $
 */
include_once(EGW_INCLUDE_ROOT.'/etemplate/inc/class.etemplate.inc.php');

class mail_sieve
{
	var $public_functions = array
		(
			'addScript'		=> True,
			'ajax_moveRules' => True,
			'deleteScript'	=> True,
			'editRule'		=> True,
			'editScript'	=> True,
			'editVacation'	=> True,
			'listScripts'	=> True,
			'index'			=> True,
			'edit'			=> True,
			'updateRules'	=> True,
			'editEmailNotification'=> True, // Added email notifications
		);
	/**
	 * Flag if we can do a timed vaction message, requires Cyrus Admin User/Pw to enable/disable via async service
	 *
	 * @var boolean
	 */
	var $timed_vacation;
	//var $scriptName = 'felamimail';

	/**
	 * @var emailadmin_sieve
	 */
	var $bosieve;

	var $errorStack;

	var $tmpl;

	var $etmpl;

	var $vtmpl;

	var $eNotitmpl;

	var $mailbo;

	var $extraAddr;

	var $currentIdentity;

	/**
	 * Constructor
	 *
	 */

	function __construct()
	{

		if(empty($GLOBALS['egw_info']['user']['preferences']['mail']['sieveScriptName']))
		{
			$GLOBALS['egw']->preferences->add('mail','sieveScriptName','felamimail', 'forced');
			$GLOBALS['egw']->preferences->save_repository();
		}
		$this->scriptName = (!empty($GLOBALS['egw_info']['user']['preferences']['mail']['sieveScriptName'])) ? $GLOBALS['egw_info']['user']['preferences']['mail']['sieveScriptName'] : 'felamimail' ;
		$this->displayCharset	= $GLOBALS['egw']->translation->charset();
		$this->botranslation	=& $GLOBALS['egw']->translation;
		$profileID = 0;
		if (isset($GLOBALS['egw_info']['user']['preferences']['mail']['ActiveProfileID']))
				$profileID = (int)$GLOBALS['egw_info']['user']['preferences']['mail']['ActiveProfileID'];
		$this->mailbo	= mail_bo::getInstance(false, $profileID, false, $oldIMAPObject=true);

		$this->mailPreferences  =& $this->mailbo->mailPreferences;
		$this->mailConfig	= config::read('mail');
		$allIdentities = $this->mailbo->getAllIdentities();
		$defaultIdentity = $this->mailbo->getDefaultIdentity();
		$this->currentIdentity = $allIdentities[$defaultIdentity];
		$this->currentIdentity['identity_string'] = mail_bo::generateIdentityString($allIdentities[$defaultIdentity],true);
		$this->restoreSessionData();
		$icServer = $this->mailbo->icServer;
		if(($icServer instanceof defaultimap) && $icServer->enableSieve)
		{
			$this->bosieve	= $icServer;
			$serverclass = get_class($icServer);
			$classsupportstimedsieve = false;
			if (!empty($serverclass) && stripos(constant($serverclass.'::CAPABILITIES'),'timedsieve') !== false) $classsupportstimedsieve = true;
			$this->timed_vacation = $classsupportstimedsieve && $icServer->enableCyrusAdmin &&
			$icServer->adminUsername && $icServer->adminPassword;
		}
		else
		{
			// we intend to die in index, to be able to die graciously
			//die(lang('Sieve not activated'));
		}
	}

	/**
	 * Sieve rules list
	 *
	 * @param array $content=null
	 * @param string $msg=null
	 */
	function index(array $content=null,$msg=null)
	{

		//Instantiate an etemplate_new object
		$tmpl = new etemplate_new('mail.sieve.index');

		if ($_GET['msg']) $msg = $_GET['msg'];
		$content['msg'] = $msg;
		if ($this->mailbo->icServer->enableSieve)
		{
			//Initializes the Grid contents
			$content['rg']= $this->get_rows($rows,$readonlys);

			// Set content-menu actions
			$tmpl->set_cell_attribute('rg', 'actions',$this->get_actions());

			$sel_options = array(
				'status' => array(
					'ENABLED' => lang('Enabled'),
					'DISABLED' => lang('Disabled'),
				)
			);
		}
		else
		{
			$content['msg'] = lang('error').':'.lang('Serverside Filterrules (Sieve) are not activated').'. '.lang('Please contact your Administrator to validate if your Server supports Serverside Filterrules, and how to enable them in EGroupware for your active Account (%1) with ID:%2.',$this->currentIdentity['identity_string'],$this->mailbo->profileID);
			$content['hideIfSieveDisabled']='mail_DisplayNone';
		}
		$tmpl->exec('mail.mail_sieve.index',$content,$sel_options,$readonlys);
	}

	/**
	 * Email Notification Edit
	 *
	 * @param type $content
	 * @param type $msg
	 */
	function editEmailNotification($content=null, $msg='')
	{
		//Instantiate an etemplate_new object, representing sieve.emailNotification
		$eNotitmpl = new etemplate_new('mail.sieve.emailNotification');

		if ($this->mailbo->icServer->enableSieve)
		{
			$eNotification = $this->getEmailNotification();

			if (!is_array($content))
			{
				$content = $eNotification;

				if (!empty($eNotification['externalEmail']))
				{
					$content['externalEmail'] = explode(",",$eNotification['externalEmail']);
				}
			}
			else
			{
				$this->restoreSessionData();
				list($button) = @each($content['button']);
				unset ($content['button']);

				switch($button)
				{
					case 'save':
					case 'apply':
						if (isset($content['status']))
						{
							//error_log(__METHOD__. 'content:' . array2string($content));
							$newEmailNotification = $content;
							if (empty($preferences->preferences['prefpreventforwarding']) ||
								$preferences->preferences['prefpreventforwarding'] == 0 )
							{
								if (is_array($content['externalEmail']) && !empty($content['externalEmail']))
								{
									$newEmailNotification['externalEmail'] = implode(",",$content['externalEmail']);
								}
							}
						}
						if (isset($content['externalEmail']) && !empty($content['externalEmail']))
						{
							if (!$this->bosieve->setEmailNotification($this->scriptName, $newEmailNotification))
							{
								$msg = lang("email notification update failed")."<br />";
								$msg .= $script->errstr. "<br />";
								break;
							}
							else
							{
								$msg .= lang("email notification successfully updated!");
							}
							//error_log(__METHOD__. '() new email notification : ' . array2string($newEmailNotification));
						}
						else
						{
							$msg .= lang('email notification update failed! You need to set an email address!');
							break;
						}
						if ($button === 'apply') break;

					case 'cancel':
						egw::redirect_link('/mail/index.php');
				}
				$this->saveSessionData();
			}

			$sel_options = array(
				'status' => array(
					'on' => lang('Active'),
					'off' => lang('Deactive'),
				),
				'displaySubject' => array(
					0 => lang('No'),
					1 => lang('Yes'),
				),
			);
			//error_log(__METHOD__. '() new email notification : ' . array2string($content));
			$content['msg'] = $msg;
		}
		else
		{
			$content['msg'] = lang('error').':'.lang('Serverside Filterrules (Sieve) are not activated').'. '.lang('Please contact your Administrator to validate if your Server supports Serverside Filterrules, and how to enable them in EGroupware for your active Account (%1) with ID:%2.',$this->currentIdentity['identity_string'],$this->mailbo->profileID);
			$content['hideIfSieveDisabled']='mail_DisplayNone';
		}
		$eNotitmpl->exec('mail.mail_sieve.editEmailNotification', $content,$sel_options);
	}

	/**
	 * Sieve rules edit
	 *
	 * @param array $content=null
	 */
	function edit ($content=null)
	{
		//Instantiate an etemplate_new object, representing sieve.edit template
		$etmpl = new etemplate_new('mail.sieve.edit');
		//error_log(__METHOD__.'() content before the action ' .array2string($content));
		if (!is_array($content))
		{
			if ( $this->getRules($_GET['ruleID']) && isset($_GET['ruleID']))
			{

				$rules = $this->rulesByID;
				$content= $rules;
				switch ($rules['action'])
				{
					case 'folder':
						$content['action_folder_text'][] = translation::convert($rules['action_arg'],'utf-8','utf7-imap');

						break;
					case 'address':

						$content['action_address_text'][] = $rules['action_arg'];
						break;
					case 'reject':
						$content['action_reject_text'] = $rules['action_arg'];
				}
				//_debug_array($content);
			}
			else // Adding new rule
			{

				$this->getRules(null);
				$newRulePriority = count($this->rules)*2+1;
				$newRules ['priority'] = $newRulePriority;
				$newRules ['status'] = 'ENABLED';
				$readonlys = array(
					'button[delete]' => 'true',
					);
				$this->rulesByID = $newRules;
				$content = $this->rulesByID;
			}
			$this->saveSessionData();
		}
		else
		{
			$this->restoreSessionData();
			list($button) = @each($content['button']);
			//$ruleID is calculated by priority from the selected rule and is an unique ID
			$ruleID = ($this->rulesByID['priority'] -1) / 2;

			switch ($button)
			{


				case 'save':
				case 'apply':
					if($content)
					{
						unset($content['button']);

						$newRule = $content;
						$newRule['priority']	= $this->rulesByID['priority'];
						$newRule['status']	= $this->rulesByID['status'];

						switch ($content['action'])
						{
							case 'folder':
								$newRule['action_arg'] = translation::convert(implode($content['action_folder_text']), 'utf7-imap', 'utf-8');
								break;
							case 'address':
								$newRule['action_arg'] = implode($content['action_address_text']);
								//error_log(__METHOD__. '() newRules_address '. array2string($newRule['action_arg']));
								break;
							case 'reject':
								$newRule['action_arg'] = $content['action_reject_text'];
						}
						unset($newRule['action_folder_text']);
						unset($newRule['action_address_text']);
						unset($newRule['action_reject_text']);

						$newRule['flg'] = 0 ;
						if( $newRule['continue'] ) { $newRule['flg'] += 1; }
						if( $newRule['gthan'] )    { $newRule['flg'] += 2; }
						if( $newRule['anyof'] )    { $newRule['flg'] += 4; }
						if( $newRule['keep'] )     { $newRule['flg'] += 8; }
						if( $newRule['regexp'] )   { $newRule['flg'] += 128; }
						error_log(__METHOD__ . 'new rules= ' .array2string($newRule));
						if($newRule['action'] && $this->rulesByID['priority'])
						{
							$this->rules[$ruleID] = $newRule;
							$ret = $this->bosieve->setRules($this->scriptName, $this->rules);
							if (!$ret && !empty($this->bosieve->error))
							{
								$msg .= lang("Saving the rule failed:")."<br />".$this->bosieve->error."<br />";
							}
							else
							{
								$msg .= lang("The rule with priority %1 successfully saved!",$ruleID);
							}
							$this->saveSessionData();
						}
						else
						{
							$msg .= "\n".lang("Error: Could not save rule").' '.lang("No action defined!");
							$error++;
						}
					}
					else
					{
						$msg .= "\n".lang("Error: Could not save rule").' '.lang("No action defined!");
						$error++;
					}
					//refresh the rules list
					//$this->sieve_egw_refresh($msg);
					if ($button == "apply") break;
				//fall through

				case 'delete':
					if ($button == "delete")
					$this->ajax_action($button, $ruleID, $msg);

				case 'cancel':
					egw_framework::window_close();
					common::egw_exit();
			}
		}
		$sel_options = array(//array_merge($sel_options,array(
			'anyof' => array(
				0 => lang('all of'),
				1 => lang('any of'),
			),
			'gthan' => array(
				0 => lang('less than'),
				1 => lang('greater than'),
			),
			'bodytransform' => array(
				0 => 'raw',
				1 => 'text',
			),
			'ctype' => emailadmin_script::$btransform_ctype_array,

		);
		//$preserv = $sel_options;
		//error_log(__METHOD__.'() content'. array2string($content));
		//Set the preselect_options for mail/folders as we are not allow free entry for folder taglist
		$mailCompose = new mail_compose();
		$sel_options['action_folder_text'] = $mailCompose->ajax_searchFolder(0,true);


		return $etmpl->exec('mail.mail_sieve.edit',$content,$sel_options,$readonlys,$preserv,2);
	}

	/**
	 * Read email notification script from the sieve script from server
	 *
	 * @return type, returns array of email notification data, and in case of failure returns false
	 */
	function getEmailNotification()
	{
		$preferences =& $this->mailPreferences;
		if(!(empty($preferences->preferences['prefpreventnotificationformailviaemail']) || $preferences->preferences['prefpreventnotificationformailviaemail'] == 0))
			die('You should not be here!');

		if($this->bosieve->getScript($this->scriptName))
		{
			if(PEAR::isError($error = $this->bosieve->retrieveRules($this->scriptName)) )
			{
				$rules    = array();
				$emailNotification = array();
			}
			else
			{
				$rules    = $this->bosieve->getRules($this->scriptName);
				$emailNotification = $this->bosieve->getEmailNotification($this->scriptName);
			}
		}
		else
		{
			// something went wrong
			error_log(__METHOD__.__LINE__.' failed');
			return false;
		}
		return $emailNotification;
	}

	/**
	 * Fetch Vacation rules and predefined Addresses from mailserver
	 *
	 * @param type $vacation
	 * @param type $msg
	 * @return type
	 */
	function getVacation(&$vacation,&$msg)
	{
		//$response->call('app.mail.sieve_vac_response_addresses');
		$preferences =& $this->mailPreferences;
		if(!(empty($preferences->preferences['prefpreventabsentnotice']) || $preferences->preferences['prefpreventabsentnotice'] == 0))
		{
			die('You should not be here!');
		}

		if($this->bosieve->getScript($this->scriptName))
		{
			if(PEAR::isError($error = $this->bosieve->retrieveRules($this->scriptName)) )
			{
				$vacation	= array();
			}
			else
			{
				$vacation	= $this->bosieve->getVacation($this->scriptName);
			}
		}
		else
		{
			// something went wrong
			$msg = lang('Unable to fetch vacation!');

		}

		$allIdentities = $this->mailbo->getAllIdentities();
		$defaultIdentity = $this->mailbo->getDefaultIdentity();
		foreach($allIdentities as $key => $singleIdentity)
		{
			if((empty($vacation))&& !empty($singleIdentity['ident_email']) && $singleIdentity['ident_email']==$allIdentities[$defaultIdentity]['ident_email'])
			{
				$selectedAddresses[$singleIdentity['ident_email']] = $singleIdentity['ident_email'];
			}
			$predefinedAddresses[$singleIdentity['ident_email']] = $singleIdentity['ident_email'];
		}
		asort($predefinedAddresses);

		return array(
			'vacation' =>$vacation,
			'aliases' => array_values($predefinedAddresses),
			);
	}

	/**
	 * Convert the taglist-email contact address "account name<email>" format to sieveRule "email" format
	 *
	 * @param type $addresses
	 */
	function email_address_converter($addresses)
	{
		error_log(__METHOD__. '() emailAddress '. array2string($addresses));
		$tagmail = array();
		foreach ($addresses as $key => $adr)
		{

			if (preg_match('/(?<=\<)[^<]+(?=\>)/', $adr,$tagmail))
			{
				$addressses = $tagmail;
				error_log(__METHOD__. '() inside the foreach' . array2string($tagmail). 'key is' . $key);
			}
		}
		if (!empty($addresses))
		{
			error_log(__METHOD__. '() emailAddress '. array2string($addresses));
			return $addressses;
		}
		else
		{
			error_log(__METHOD__. '() No email address(es)');
			return false;
		}
	}

	/**
	 * Vacation edit
	 *
	 * @param type $content
	 * @param type $msg
	 */
	function editVacation($content=null, $msg='')
	{

		//Instantiate an etemplate_new object, representing the sieve.vacation template
		$vtmpl = new etemplate_new('mail.sieve.vacation');
		if ($this->mailbo->icServer->enableSieve)
		{
			$vacRules = $this->getVacation($vacation,$msg);
			if ($this->timed_vacation)
			{
				include_once(EGW_API_INC.'/class.jscalendar.inc.php');
				$ByDate = array('by_date' => lang('By date'));
			}
			if (!is_array($content))
			{
				$content = $vacation = $vacRules['vacation'];
				if (empty($vacation['addresses'])) $content['addresses']='';
				if (!empty($vacation['forwards']))
				{
					$content['forwards'] = explode(",",$vacation['forwards']);
				}
				else
				{
					$content['forwards'] = '';
				}
			}
			else
			{
				$this->restoreSessionData();
				list($button) = @each($content['button']);
				unset ($content['button']);

				switch($button)
				{

					case 'save':

					case 'apply':
						if ($GLOBALS['egw_info']['user']['apps']['admin'])
						{
							// store text as default
							if ($content['set_as_default'] == 1)
							{
								config::save_value('default_vacation_text', $content['text'], 'mail');
							}
						}
						if (isset($content['status']))
						{
							//error_log(__METHOD__. 'content:' . array2string($content));
							$newVacation = $content;
							if (empty($preferences->preferences['prefpreventforwarding']) ||
								$preferences->preferences['prefpreventforwarding'] == 0 )
							{
								if (is_array($content['forwards']) && !empty($content['forwards']))
								{

									$newVacation['forwards'] = implode(",",$content['forwards']);
								}
								else
								{
									$newVacation ['forwards'] = '';
								}
							}
							else
							{
								unset($newVacation ['forwards']);
							}

							if (!in_array($newVacation['status'],array('on','off','by_date'))) $newVacation['status'] = 'off';

							$checkAddresses = (isset($content['check_mail_sent_to']) && ($content['check_mail_sent_to']) != 0) ? true: false;
							if ($content['addresses'])
							{
								$newVacation ['addresses'] = $content['addresses'];
							}
							else
							{

							}

							if($this->checkRule($newVacation,$checkAddresses))
							{
								if (!$this->bosieve->setVacation($this->scriptName, $newVacation))
								{
									$msg = lang('vacation update failed') . "\n" . lang('Vacation notice update failed') . ":" . $this->bosieve->error;
									break;
								}
								else
								{
									if (!isset($newVacation['scriptName']) || empty($newVacation['scriptName'])) $newVacation['scriptName'] = $this->scriptName;
									$this->bosieve->setAsyncJob($newVacation);
									$msg = lang('Vacation notice sucessfully updated.');
								}
							}
							else
							{
								$msg .= implode("\n",$this->errorStack);
							}
							egw_framework::refresh_opener($msg, 'mail','edit');
							if ($button === 'apply') break;
						}
					case 'cancel':
						egw_framework::window_close();

				}
				$vacation = $newVacation;

				$this->saveSessionData();
			}

			$sel_options = array(
				'status' => array(
					'on' => lang('Active'),
					'off' => lang('Deactive'),
				),
				'addresses' => array_combine($vacRules['aliases'],$vacRules['aliases']),
			);
			if (!empty($ByDate))
			{
				$sel_options['status'] += $ByDate;
			}
			$content['msg'] = $msg;
		}
		else
		{
			$content['msg'] = lang('error').':'.lang('Serverside Filterrules (Sieve) are not activated').'. '.lang('Please contact your Administrator to validate if your Server supports Serverside Filterrules, and how to enable them in EGroupware for your active Account (%1) with ID:%2.',$this->currentIdentity['identity_string'],$this->mailbo->profileID);
			$content['hideIfSieveDisabled']='mail_DisplayNone';
		}
		$vtmpl->exec('mail.mail_sieve.editVacation',$content,$sel_options,$readonlys,array(),2);
	}

	/**
	 * Checking vaction validation
	 *
	 * @param type $_vacation
	 * @param type $_checkAddresses
	 * @return boolean
	 */
	function checkRule($_vacation,$_checkAddresses=true)
	{
		$this->errorStack = array();

		if (!$_vacation['text'])
		{
			$this->errorStack['text'] = lang('Please supply the message to send with auto-responses').'!	';
		}

		if (!$_vacation['days'])
		{
			$this->errorStack['days'] = lang('Please select the number of days to wait between responses').'!';
		}

		if(is_array($_vacation['addresses']))
		{
			$regexp="/^[a-z0-9]+([_\\.-][a-z0-9]+)*@([a-z0-9]+([\.-][a-z0-9]+)*)+\\.[a-z]{2,}$/i";
			foreach ($_vacation['addresses'] as $addr)
			{
				if (!preg_match($regexp,$addr) && $_checkAddresses)
				{
					$this->errorStack['addresses'] = lang('One address is not valid').'!';
				}
			}
		}
		else
		{
			$this->errorStack['addresses'] = lang('Please select a address').'!';
		}
		if ($_vacation['status'] == 'by_date')
		{
			if (!$_vacation['start_date'] || !$_vacation['end_date'])
			{
				$this->errorStack['status'] = lang('Activating by date requires a start- AND end-date!');
			}
			elseif($_vacation['start_date'] > $_vacation['end_date'])
			{
				$this->errorStack['status'] = lang('Vacation start-date must be BEFORE the end-date!');
			}
		}
		if ($_vacation['forwards'])
		{
			foreach(preg_split('/, ?/',$_vacation['forwards']) as $addr)
			{
				if (!preg_match($regexp,$addr) && $_checkAddresses)
				{
					$this->errorStack['forwards'] = lang('One address is not valid'.'!');
				}
			}
		}
		error_log(__METHOD__. array2string($this->errorStack));
		if(count($this->errorStack) == 0)
		{
			return true;
		}
		else
		{
			$this->errorStack['message'] = lang('Vacation notice is not saved yet! (But we filled in some defaults to cover some of the above errors. Please correct and check your settings and save again.)');
			return false;
		}
	}

	/**
	 * Move rule to an other position in list
	 *
	 * @param type $objType
	 * @param type $orders
	 */
	function ajax_moveRule($objType, $orders)
	{

		foreach ($orders as $keys => $val) $orders[$keys] = $orders[$keys] -1;

		$this->getRules(null);

		//_debug_array($this->rules);
		$newrules = $this->rules;
		$keyloc = 0;
		foreach($orders as $keys => $ruleID)
		{
			error_log(__METHOD__.'() ruleID= '. $ruleID);
			$newrules[$keys] = $this->rules[$ruleID];
		}

		$msg = 'the rule with priority moved from ' . $from . ' to ' . $to;
		$this->rules = $newrules;
		$this->updateScript();
		$this->saveSessionData();

		//Calling to referesh after move action
		$this->sieve_egw_refresh($msg);

	}

	/**
	 * call the client side refresh method
	 *
	 * @param type $msg
	 */
	function sieve_egw_refresh($msg)
	{
		$response = egw_json_response::get();
		$response->call('app.mail.sieve_egw_refresh',null,$msg);
	}

	/**
	 * Ajax function to handle the server side content for refreshing the form
	 *
	 * @param type $execId,
	 * @param type $msg
	 */
	function ajax_sieve_egw_refresh($execId,$msg)
	{
		//Need to read the template to use for refreshing the form
		$response = egw_json_response::get();
		$request= etemplate_request::read($execId);

		$content['rg'] = $this->get_rows($rows,$readonlys);
		$content['msg'] = $msg;
		$request->content = $content;
		$data = array(
			'etemplate_exec_id' => $request->id(),

			'app_header' => $request->app_header,
			'content' => $request->content,
			'sel_options' => $request->sel_options,
			'readonlys' => $request->readonlys,
			'modifications' => $request->modifications,
			'validation_errors' => $validation_errors,
		);

		$response->generic('et2_load', array(
			'name' => 'mail.sieve.index',
			'url' => $GLOBALS['egw_info']['server']['webserver_url'].etemplate_widget_template::relPath('mail.sieve.index'),
			'data' => $data,
			'DOMNodeID' => 'mail-sieve-index'
		));
		//error_log(__METHOD__. "RESPONSE".array2string($response));
	}

	/**
	 * Ajax function to handle actions over sieve rules list on gd
	 *
	 * @param type $actions
	 * @param type $checked
	 * @param type $action_msg
	 * @param type $msg
	 */
	function ajax_action($action,$checked,$msg)
	{
		$this->getRules(null);

		switch ($action)
		{
			case 'delete':
				if ($checked === count($this->rules)-1)
				{
					$msg = lang('rule with priority ') . $checked . lang(' deleted!');
				}else
				{

					$msg = lang('rule with priority ') . $checked . lang(' deleted!') . lang(' And the rule with priority %1, now got the priority %2',$checked+1,$checked);
				}
				unset($this->rules[$checked]);
				$this->rules = array_values($this->rules);
				break;
			case 'enable':
				$msg = lang('rule with priority ') . $checked . lang(' enabled!');
				$this->rules[$checked][status] = 'ENABLED';
				break;
			case 'disable':
				$msg = lang('rule with priority ') . $checked . lang(' disabled!');
				$this->rules[$checked][status] = 'DISABLED';
				break;
			case 'move':
				break;
		}

		$this->updateScript();
		$this->saveSessionData();

		//Refresh the form
		$this->sieve_egw_refresh($msg);
	}

	/**
	 * Add script to sieve script
	 *
	 */
	function addScript()
	{
		if($scriptName = $_POST['newScriptName'])
		{
			$this->bosieve->installScript($scriptName, '');
		}
			$this->listScripts();
	}

	/**
	 * Convert an script seive format rule to human readable format
	 *
	 * @param type $rule
	 * @return string,  return the rule as a string.
	 */
	function buildRule($rule)
	{
		$andor = ' '. lang('and') .' ';
		$started = 0;
		if ($rule['anyof']) $andor = ' '. lang('or') .' ';
		$complete = lang('IF').' ';
		if ($rule['unconditional']) $complete = "[Unconditional] ";
		if ($rule['from'])
		{
			$match = $this->setMatchType($rule['from'],$rule['regexp']);
			$complete .= "'From:' " . $match . " '" . $rule['from'] . "'";
			$started = 1;
		}
		if ($rule['to'])
		{
			if ($started) $complete .= $andor;
			$match = $this->setMatchType($rule['to'],$rule['regexp']);
			$complete .= "'To:' " . $match . " '" . $rule['to'] . "'";
			$started = 1;
		}
		if ($rule['subject'])
		{
			if ($started) $complete .= $andor;
			$match = $this->setMatchType($rule['subject'],$rule['regexp']);
			$complete .= "'Subject:' " . $match . " '" . $rule['subject'] . "'";
			$started = 1;
		}
		if ($rule['field'] && $rule['field_val'])
		{
			if ($started) $complete .= $andor;
			$match = $this->setMatchType($rule['field_val'],$rule['regexp']);
			$complete .= "'" . $rule['field'] . "' " . $match . " '" . $rule['field_val'] . "'";
			$started = 1;
		}
		if ($rule['size'])
		{
			$xthan = " less than '";
			if ($rule['gthan']) $xthan = " greater than '";
			if ($started) $complete .= $andor;
			$complete .= "message " . $xthan . $rule['size'] . "KB'";
			$started = 1;
		}
		if (!empty($rule['field_bodytransform']))
		{
			if ($started) $newruletext .= ", ";
			$btransform	= " :raw ";
			$match = ' :contains';
			if ($rule['bodytransform'])	$btransform = " :text ";
			if (preg_match("/\*|\?/", $rule['field_bodytransform'])) $match = ':matches';
			if ($rule['regexp']) $match = ':regex';
			$complete .= " body " . $btransform . $match . " \"" . $rule['field_bodytransform'] . "\"";
			$started = 1;

		}
		if ($rule['ctype']!= '0' && !empty($rule['ctype']))
		{
			if ($started) $newruletext .= ", ";
			$btransform_ctype = emailadmin_script::$btransform_ctype_array[$rule['ctype']];
			$ctype_subtype = "";
			if ($rule['field_ctype_val']) $ctype_subtype = "/";
			$complete .= " body :content " . " \"" . $btransform_ctype . $ctype_subtype . $rule['field_ctype_val'] . "\"" . " :contains \"\"";
			$started = 1;
			//error_log(__CLASS__."::".__METHOD__.array2string(emailadmin_script::$btransform_ctype_array));
		}
		if (!$rule['unconditional']) $complete .= ' '.lang('THEN').' ';
		if (preg_match("/folder/i",$rule['action']))
			$complete .= lang('file into')." '" . $rule['action_arg'] . "';";
		if (preg_match("/reject/i",$rule['action']))
			$complete .= lang('reject with')." '" . $rule['action_arg'] . "'.";
		if (preg_match("/address/i",$rule['action']))
			$complete .= lang('forward to').' ' . $rule['action_arg'] .'.';
		if (preg_match("/discard/i",$rule['action']))
			$complete .= lang('discard').'.';
		if ($rule['continue']) $complete .= " [Continue]";
		if ($rule['keep']) $complete .= " [Keep a copy]";
		return $complete;
	}

	/**
	 *
	 * @param type $matchstr
	 * @param type $regex
	 * @return type
	 */
	function setMatchType (&$matchstr, $regex = false)
	{
		$match = lang('contains');
		if (preg_match("/\s*!/", $matchstr))
			$match = lang('does not contain');
		if (preg_match("/\*|\?/", $matchstr))
		{
			$match = lang('matches');
			if (preg_match("/\s*!/", $matchstr))
				$match = lang('does not match');
		}
		if ($regex)
		{
			$match = lang('matches regexp');
			if (preg_match("/\s*!/", $matchstr))
				$match = lang('does not match regexp');
		}
		$matchstr = preg_replace("/^\s*!/","",$matchstr);
		return $match;
	}

	/**
	 * Save sieve script
	 */
	function saveScript()
	{
		$scriptName 	= $_POST['scriptName'];
		$scriptContent	= $_POST['scriptContent'];
		if(isset($scriptName) and isset($scriptContent))
		{
			if($this->sieve->sieve_sendscript($scriptName, stripslashes($scriptContent)))
			{
				#print "Successfully loaded script onto server. (Remember to set it active!)<br>";
			}
		}
			$this->mainScreen();
	}

	/**
	 * Save session data
	 */
	function saveSessionData()
	{
		$sessionData['sieve_rules']		= $this->rules;
		$sessionData['sieve_rulesByID'] = $this->rulesByID;
		$sessionData['sieve_scriptToEdit']	= $this->scriptToEdit;
		$GLOBALS['egw']->session->appsession('sieve_session_data','',$sessionData);
	}

	/**
	 * Update the sieve script on mail server
	 */
	function updateScript()
	{
		if (!$this->bosieve->setRules($this->scriptToEdit, $this->rules))
		{
			print "update failed<br>";exit;
		}
	}

	/**
	 * getRules()
	 * Fetched rules save on array()rules.
	 *
	 * @return boolean, returns false in case of failure and true in case of success.
	 */
	function getRules($ruleID)
	{
		if($script = $this->bosieve->getScript($this->scriptName))
		{
			$this->scriptToEdit 	= $this->scriptName;
			if(PEAR::isError($error = $this->bosieve->retrieveRules($this->scriptName)) )
			{
				error_log(__METHOD__.__LINE__.$error->message);
				$this->rules	= array();
				$this->rulesByID = array();
				$this->vacation	= array();
			}
			else
			{
				$this->rules	= $this->bosieve->getRules($this->scriptName);
				$this->rulesByID = $this->rules[$ruleID];
				$this->vacation	= $this->bosieve->getVacation($this->scriptName);
			}
			//$ruleslist= preg_match('#rule',$script, $subject)
			return true;
		}
		else
		{
			// something went wrong
			error_log(__METHOD__.__LINE__.' failed');
			return false;
		}
		//error_log(__METHOD__.array2string( $script));
	}


	/**
	 * Restore session data
	 */
	function restoreSessionData()
	{
		$sessionData = $GLOBALS['egw']->session->appsession('sieve_session_data');
		$this->rules		= $sessionData['sieve_rules'];
		$this->rulesByID = $sessionData['sieve_rulesByID'];
		$this->scriptToEdit	= $sessionData['sieve_scriptToEdit'];
	}

	/**
	 * Get the data for iterating the rows on rules list grid
	 *
	 * @return type
	 */
	function get_rows(&$rows,&$readonlys)
	{
		$rows = array();
		$this->getRules(null);	/* ADDED BY GHORTH */
		//$this->saveSessionData();

		if (is_array($this->rules) && !empty($this->rules) )
		{
			$rows = $this->rules;

			foreach ($rows as &$row )
			{
				$row['rules'] = $this->buildRule($row);
				$row['ruleID'] =(string)(($row['priority'] -1) / 2 );
				if ($row ['status'] === 'ENABLED')
				{
					$row['class'] = 'mail_sieve_ENABLED';
				}
			}

			//error_log(__METHOD__. array2string($rows));
			//_debug_array($rows);
		}else
		{
			//error_log(__METHOD__.'There are no rules or something is went wrong at getRules()!');
			return ;
		}
		array_unshift($rows,array(''=> ''));
		//_debug_array($rows);
		return $rows;
	}

	/**
	 * Get actions / context menu for index
	 *
	 *
	 *
	 * @return array, returns defined actions as an array
	 */
	private function get_actions(array $query=array())
	{
		$actions =array(

			'edit' => array(
				'caption' => 'Edit',
				'default' => true,
				'onExecute' => 'javaScript:app.mail.action'
			),
			'add' => array(
				'caption' => 'Add',
				'onExecute' => 'javaScript:app.mail.action'
			),
			'enable' => array(
				'caption' => 'Enable',
				'onExecute' => 'javaScript:app.mail.action',
				//'enableClass' => 'mail_sieve_ENABLED',
				//'hideOnDisabled' => true,
			),
			'disable' => array(
				'caption' => 'Disable',
				'onExecute' => 'javaScript:app.mail.action',
				'disableClass' => 'mail_sieve_ENABLED',
				'hideOnDisabled' => true,

			),
			'delete' => array(
				'caption' => 'Delete',
				'onExecute' => 'javaScript:app.mail.action'
			),

		);
		//_debug_array($actions);
		return $actions;
	}

}
?>
